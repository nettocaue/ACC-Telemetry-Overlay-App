import path from 'node:path';
import {
  app,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
  globalShortcut,
  screen,
  autoUpdater,
} from 'electron';
import started from 'electron-squirrel-startup';
import { AccBroadcastClient } from './broadcast/accBroadcastClient.js';
import { AccSharedMemoryClient } from './telemetry/accSharedMemory.js';
import { loadSettings, saveSettings } from './config/settingsStore.js';
import { ensureBroadcastingConfig } from './config/accConfig.js';
import { WIDGET_DEFS } from './widgets/registry.js';
import { RemoteServer, generateToken } from './remote/remoteServer.js';
import { qrToSvg } from './remote/qrCode.js';
import { VJoyDevice } from './controller/vJoy.js';
import { PhoneController } from './controller/phoneController.js';
import iconPath from './assets/icon.png';
import phoneHtml from './phone/index.html?raw';
import phoneJs from './phone/phone.js?raw';
import phoneCss from './phone/phone.css?raw';

if (started) {
  app.quit();
} else {
  const gotSingleInstanceLock = app.requestSingleInstanceLock();
  if (!gotSingleInstanceLock) {
    app.quit();
  } else {
    runApp();
  }
}

function runApp() {
  let mainWindow = null;
  let tray = null;
  let lockedWindows = [];
  let updateDownloaded = false;
  const widgetWindows = new Map();
  let editModeEnabled = false;
  // Tracks locked windows being closed intentionally so their 'closed'
  // handlers don't schedule a spurious createLockedWindows() respawn.
  const closingLockedWindows = new Set();
  const broadcastClient = new AccBroadcastClient();
  const sharedMemoryClient = new AccSharedMemoryClient();
  // `settings` is the live, possibly-unsaved state the overlays render from;
  // `savedSettings` mirrors what's on disk. Widget toggles and geometry only
  // touch `settings` until the user hits "Salvar" for the active profile.
  const settings = loadSettings();
  let savedSettings = structuredClone(settings);
  let profileDirty = false;

  // Returns the widgets map for the currently active profile.
  const aw = () => {
    const p = settings.profiles[settings.activeProfile];
    if (!p) {
      settings.activeProfile = Object.keys(settings.profiles)[0];
      return settings.profiles[settings.activeProfile].widgets;
    }
    return p.widgets;
  };

  // A profile can be switched off as a whole without touching each widget's
  // own toggle, so turning it back on restores exactly what was enabled.
  const isProfileEnabled = () =>
    settings.profiles[settings.activeProfile]?.enabled !== false;
  const isWidgetConfigured = (id) => aw()[id]?.enabled !== false;
  const isWidgetEnabled = (id) => isProfileEnabled() && isWidgetConfigured(id);

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  const broadcastToWindows = (channel, payload) => {
    mainWindow?.webContents.send(channel, payload);
    for (const win of lockedWindows) {
      win.webContents.send(channel, payload);
    }
    for (const win of widgetWindows.values()) {
      win.webContents.send(channel, payload);
    }
  };

  // Shared-memory data (physics) updates at up to 60Hz. Telemetry has its
  // own dedicated window always, so it alone gets every tick. tyres/fuel/
  // damage don't change fast enough to need that, so they're throttled
  // down to ~10Hz — whether they're in their own edit-mode window or
  // sharing a per-monitor locked window with other widgets, since locked
  // windows never contain telemetry and so never need the full rate.
  const PHYSICS_SLOW_WIDGET_IDS = ['tyres', 'fuel', 'damage', 'weather'];
  const PHYSICS_SLOW_DIVIDER = 6; // 60Hz / 6 = 10Hz
  let physicsTickCount = 0;
  const sendToPhysicsWidgets = (channel, payload) => {
    widgetWindows.get('telemetry')?.webContents.send(channel, payload);

    physicsTickCount++;
    if (physicsTickCount % PHYSICS_SLOW_DIVIDER === 0) {
      for (const id of PHYSICS_SLOW_WIDGET_IDS) {
        widgetWindows.get(id)?.webContents.send(channel, payload);
      }
      for (const win of lockedWindows) {
        win.webContents.send(channel, payload);
      }
    }
  };
  const sendToAllPhysicsWidgets = (channel, payload) => {
    widgetWindows.get('telemetry')?.webContents.send(channel, payload);
    for (const id of PHYSICS_SLOW_WIDGET_IDS) {
      widgetWindows.get(id)?.webContents.send(channel, payload);
    }
    for (const win of lockedWindows) {
      win.webContents.send(channel, payload);
    }
  };

  broadcastClient.on('connected', (data) =>
    broadcastToWindows('acc:connected', data),
  );
  broadcastClient.on('registrationFailed', (msg) =>
    broadcastToWindows('acc:registrationFailed', msg),
  );
  broadcastClient.on('realtimeUpdate', (data) =>
    broadcastToWindows('acc:realtimeUpdate', data),
  );
  // ACC only sends driver names when the entry list is requested, so keep the
  // latest copy here: overlay windows created later (edit mode, profile
  // switch) fetch it on mount instead of showing nameless rows.
  const entryListCache = new Map(); // carIndex -> entryListCar payload
  let lastEntryListRequestAt = 0;
  const requestEntryListThrottled = () => {
    const now = Date.now();
    if (now - lastEntryListRequestAt < 1000) return;
    lastEntryListRequestAt = now;
    broadcastClient.requestEntryList();
  };
  ipcMain.handle('acc:getEntryList', () => [...entryListCache.values()]);

  broadcastClient.on('realtimeCarUpdate', (data) => {
    // A car we have no entry for (joined mid-session) or whose driver count
    // changed means our names are stale — ask ACC for a fresh entry list
    // (same rule as Kunos's reference broadcasting client).
    const entry = entryListCache.get(data.carIndex);
    if (!entry || entry.drivers.length !== data.driverCount) {
      requestEntryListThrottled();
    }
    broadcastToWindows('acc:realtimeCarUpdate', data);
  });
  broadcastClient.on('entryList', (data) => {
    const current = new Set(data.carIndices);
    for (const idx of entryListCache.keys()) {
      if (!current.has(idx)) entryListCache.delete(idx);
    }
    broadcastToWindows('acc:entryList', data);
  });
  broadcastClient.on('entryListCar', (data) => {
    entryListCache.set(data.carIndex, data);
    broadcastToWindows('acc:entryListCar', data);
  });
  broadcastClient.on('trackData', (data) =>
    broadcastToWindows('acc:trackData', data),
  );
  broadcastClient.on('broadcastingEvent', (data) =>
    broadcastToWindows('acc:broadcastingEvent', data),
  );
  broadcastClient.on('error', (err) =>
    broadcastToWindows('acc:error', err.message),
  );
  broadcastClient.on('parseError', (err) =>
    broadcastToWindows('acc:parseError', err.message),
  );
  broadcastClient.on('reregistering', () =>
    broadcastToWindows('acc:reregistering', null),
  );

  sharedMemoryClient.on('physics', (data) =>
    sendToPhysicsWidgets('acc:physics', data),
  );
  sharedMemoryClient.on('static', (data) =>
    sendToAllPhysicsWidgets('acc:staticTelemetry', data),
  );
  sharedMemoryClient.on('graphics', (data) =>
    broadcastToWindows('acc:graphics', data),
  );
  sharedMemoryClient.on('error', (err) =>
    broadcastToWindows('acc:sharedMemoryError', err.message),
  );
  sharedMemoryClient.start(16); // ~60Hz — matches frame rate, minimizes pedal/RPM trace lag

  // --- Phone dash (served over the local network) --------------------------
  const DEFAULT_REMOTE_PORT = 8770;
  const remoteServer = new RemoteServer({
    certPath: path.join(app.getPath('userData'), 'remote-cert.json'),
    assets: { html: phoneHtml, js: phoneJs, css: phoneCss },
  });
  sharedMemoryClient.on('physics', (data) => remoteServer.updatePhysics(data));
  sharedMemoryClient.on('static', (data) => remoteServer.updateStatic(data));
  sharedMemoryClient.on('graphics', (data) => remoteServer.updateGraphics(data));

  // Phone as a wheel: opt-in, because it needs the vJoy driver installed.
  const phoneController = new PhoneController({ device: new VJoyDevice(1) });
  remoteServer.on('input', (id, input) => phoneController.handleInput(id, input));
  remoteServer.on('shift', (id, dir) => phoneController.handleShift(id, dir));
  remoteServer.on('bind', (id, target) => phoneController.handleBind(id, target));
  remoteServer.on('button', (id, button, pressed) =>
    phoneController.handleButton(id, button, pressed),
  );
  remoteServer.on('clientGone', (id) => phoneController.clientGone(id));
  phoneController.on('status', (state) => {
    remoteServer.setControllerState(state);
    mainWindow?.webContents.send('remote:status', remoteStatus());
  });

  const remoteStatus = () => {
    const status = remoteServer.status();
    return {
      ...status,
      enabled: Boolean(settings.remote?.enabled),
      controller: {
        ...phoneController.status(),
        enabled: Boolean(settings.remote?.controller),
      },
      addresses: status.addresses.map((a) => ({
        ...a,
        qrSvg: qrToSvg(a.url),
      })),
    };
  };
  remoteServer.on('status', () =>
    mainWindow?.webContents.send('remote:status', remoteStatus()),
  );

  const startRemoteServer = () => {
    // The token is part of the QR code; it's created once and kept, so a
    // phone that already scanned it reconnects on its own next time.
    if (!settings.remote?.token) {
      const token = generateToken();
      updateBothSettings((s) => {
        s.remote = { ...s.remote, token };
      });
    }
    remoteServer.start({
      port: settings.remote.port ?? DEFAULT_REMOTE_PORT,
      token: settings.remote.token,
    });
  };

  ipcMain.handle('remote:getStatus', () => remoteStatus());
  ipcMain.handle('remote:setEnabled', (_e, enabled) => {
    updateBothSettings((s) => {
      s.remote = { ...s.remote, enabled };
    });
    if (enabled) {
      startRemoteServer();
      if (settings.remote?.controller) phoneController.enable();
    } else {
      phoneController.disable();
      remoteServer.stop();
    }
    return remoteStatus();
  });
  ipcMain.handle('remote:setController', (_e, enabled) => {
    updateBothSettings((s) => {
      s.remote = { ...s.remote, controller: enabled };
    });
    if (enabled && settings.remote?.enabled) phoneController.enable();
    else phoneController.disable();
    return remoteStatus();
  });

  ipcMain.handle('acc:reconnect', () => {
    broadcastClient.disconnect();
    const broadcastConfig = ensureBroadcastingConfig();
    broadcastClient.connect({
      host: '127.0.0.1',
      port: broadcastConfig.port,
      displayName: 'ACC Telemetry App',
      connectionPassword: broadcastConfig.connectionPassword,
      commandPassword: broadcastConfig.commandPassword,
    });
  });

  let savePositionTimeout = null;
  const schedulePersistSettings = () => {
    clearTimeout(savePositionTimeout);
    savePositionTimeout = setTimeout(() => saveSettings(savedSettings), 400);
  };

  const setProfileDirty = (dirty) => {
    if (profileDirty === dirty) return;
    profileDirty = dirty;
    mainWindow?.webContents.send('profiles:dirtyChanged', dirty);
  };

  // Applies a structural change (switch/create/rename/...) to both the live
  // and the saved state, so it persists without committing unsaved edits.
  const updateBothSettings = (fn) => {
    fn(settings);
    fn(savedSettings);
    schedulePersistSettings();
  };

  // Throws away unsaved widget edits of the active profile.
  const discardUnsavedProfile = () => {
    if (!profileDirty) return;
    const name = settings.activeProfile;
    if (savedSettings.profiles[name]) {
      settings.profiles[name] = structuredClone(savedSettings.profiles[name]);
    }
    setProfileDirty(false);
  };

  // Editing uses one native OS window per widget (easy to drag/resize
  // independently, including across monitors). Once the user is done, every
  // widget except Telemetry collapses into one shared window per monitor —
  // Telemetry keeps its own dedicated window/process permanently, in both
  // modes, because it's the only widget that needs real 60Hz updates; piling
  // it into the shared window made it compete for the same thread as
  // everything else and brought the jank right back.
  const setEditMode = (enabled) => {
    if (editModeEnabled === enabled) return; // already in this state — nothing to do
    editModeEnabled = enabled; // set before closing windows so their
    // unexpected-exit handlers see the new mode and don't try to respawn.

    const telemetryWin = widgetWindows.get('telemetry');
    if (telemetryWin) {
      telemetryWin.setIgnoreMouseEvents(!enabled);
      telemetryWin.setResizable(enabled);
      telemetryWin.webContents.send('editMode:changed', enabled);
    }

    if (enabled) {
      closeLockedWindows();
      for (const def of WIDGET_DEFS) {
        if (def.id === 'telemetry') continue; // already has its own window
        if (isWidgetEnabled(def.id) && !widgetWindows.has(def.id))
          createWidgetWindow(def);
      }
    } else {
      for (const [id, win] of widgetWindows) {
        if (id === 'telemetry') continue; // keeps its window across modes
        win.close();
        widgetWindows.delete(id);
      }
      createLockedWindows();
    }
    mainWindow?.webContents.send('editMode:changed', enabled);
  };

  ipcMain.handle('editMode:get', () => editModeEnabled);
  ipcMain.handle('editMode:toggle', () => {
    setEditMode(!editModeEnabled);
    return editModeEnabled;
  });

  // Manual JS-driven resize, since native OS edge-resize hit-testing is
  // unreliable for frameless/transparent/always-on-top windows on Windows.
  const MIN_WIDGET_SIZE = 100;
  const resizeBaseSizes = new Map();

  ipcMain.handle('overlay:resizeStart', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) resizeBaseSizes.set(win.id, win.getSize());
  });

  ipcMain.handle('overlay:resizeBy', (event, dx, dy) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    const base = resizeBaseSizes.get(win.id) ?? win.getSize();
    const width = Math.max(MIN_WIDGET_SIZE, Math.round(base[0] + dx));
    const height = Math.max(MIN_WIDGET_SIZE, Math.round(base[1] + dy));
    win.setSize(width, height);
  });

  const createWidgetWindow = (def) => {
    const saved = aw()[def.id] ?? {};
    const win = new BrowserWindow({
      width: saved.width ?? def.width,
      height: saved.height ?? def.height,
      x: saved.x ?? def.x,
      y: saved.y ?? def.y,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: false,
      skipTaskbar: true,
      webPreferences: {
        preload: OVERLAY_WINDOW_PRELOAD_WEBPACK_ENTRY,
        // Chromium throttles timers/rAF for unfocused windows to save
        // resources — exactly what we want for widgets that don't need
        // frame-perfect updates. Only the pedal/RPM trace actually needs
        // full-rate updates, so it's the only one that opts out.
        backgroundThrottling: def.id !== 'telemetry',
      },
    });
    win.loadURL(`${OVERLAY_WINDOW_WEBPACK_ENTRY}?widget=${def.id}`);
    win.setIgnoreMouseEvents(!editModeEnabled);
    win.setResizable(editModeEnabled);

    const persist = () => {
      const [x, y] = win.getPosition();
      const [width, height] = win.getSize();
      aw()[def.id] = { ...aw()[def.id], x, y, width, height };
      setProfileDirty(true);
    };
    win.on('moved', persist);
    win.on('resized', persist);

    // A widget the user turned on should stay up until they turn it off —
    // if its renderer dies unexpectedly (crash, GPU reset) rather than being
    // closed via hideWidget (which flips `enabled` first), bring it back.
    let exitHandled = false;
    const handleUnexpectedExit = () => {
      if (exitHandled) return;
      exitHandled = true;
      widgetWindows.delete(def.id);
      // Telemetry always has its own window regardless of edit/locked mode;
      // every other individually-windowed widget only does during editing.
      const shouldRespawn =
        def.id === 'telemetry'
          ? isWidgetEnabled(def.id)
          : editModeEnabled && isWidgetEnabled(def.id);
      if (shouldRespawn) {
        setTimeout(() => showWidget(def.id), 1000);
      }
    };
    win.webContents.on('render-process-gone', () => {
      handleUnexpectedExit();
      if (!win.isDestroyed()) win.destroy();
    });
    win.on('closed', handleUnexpectedExit);

    widgetWindows.set(def.id, win);
  };

  const showWidget = (id) => {
    if (widgetWindows.has(id)) return;
    const def = WIDGET_DEFS.find((d) => d.id === id);
    if (def) createWidgetWindow(def);
  };

  const hideWidget = (id) => {
    widgetWindows.get(id)?.close();
    widgetWindows.delete(id);
  };

  const getWidgetListWithGeometry = () =>
    WIDGET_DEFS.map((def) => {
      const saved = aw()[def.id] ?? {};
      return {
        id: def.id,
        title: def.title,
        enabled: isWidgetConfigured(def.id),
        x: saved.x ?? def.x,
        y: saved.y ?? def.y,
        width: saved.width ?? def.width,
        height: saved.height ?? def.height,
      };
    });

  ipcMain.handle('widgets:list', () => getWidgetListWithGeometry());

  // One window per monitor that actually has an enabled widget on it,
  // sized to that monitor's own reported bounds — not a computed union of
  // every display. On mixed-DPI/mixed-orientation multi-monitor setups a
  // union can come out smaller than any single display (each display's
  // bounds are independently DPI-scaled), silently clipping widgets off
  // the edge. Per-display windows sidestep that entirely.
  const closeLockedWindows = () => {
    for (const win of lockedWindows) {
      closingLockedWindows.add(win);
      win.close();
    }
    lockedWindows = [];
  };

  const createLockedWindowForDisplay = (display, widgetIds) => {
    const { x, y, width, height } = display.bounds;
    const win = new BrowserWindow({
      x,
      y,
      width,
      height,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: false,
      skipTaskbar: true,
      hasShadow: false,
      webPreferences: {
        preload: OVERLAY_WINDOW_PRELOAD_WEBPACK_ENTRY,
        backgroundThrottling: false,
      },
    });
    win.loadURL(
      `${OVERLAY_WINDOW_WEBPACK_ENTRY}?mode=locked&originX=${x}&originY=${y}&ids=${widgetIds.join(',')}`,
    );
    win.setIgnoreMouseEvents(true);

    let exitHandled = false;
    const handleUnexpectedExit = () => {
      if (exitHandled) return;
      exitHandled = true;
      const intentional = closingLockedWindows.has(win);
      closingLockedWindows.delete(win);
      lockedWindows = lockedWindows.filter((w) => w !== win);
      // Only respawn on genuine unexpected crashes — intentional closes
      // (from closeLockedWindows) must not trigger a second rebuild.
      if (!intentional && !editModeEnabled) {
        setTimeout(() => {
          if (!editModeEnabled) createLockedWindows();
        }, 1000);
      }
    };
    win.webContents.on('render-process-gone', () => {
      handleUnexpectedExit();
      if (!win.isDestroyed()) win.destroy();
    });
    win.on('closed', handleUnexpectedExit);

    lockedWindows.push(win);
  };

  const createLockedWindows = () => {
    // Telemetry always lives in its own dedicated window (see setEditMode).
    if (!isProfileEnabled()) return;
    const enabledWidgets = getWidgetListWithGeometry().filter(
      (w) => w.enabled && w.id !== 'telemetry',
    );
    const groups = new Map(); // display.id -> { display, widgetIds }
    for (const w of enabledWidgets) {
      const display = screen.getDisplayNearestPoint({
        x: Math.round(w.x + w.width / 2),
        y: Math.round(w.y + w.height / 2),
      });
      if (!groups.has(display.id))
        groups.set(display.id, { display, widgetIds: [] });
      groups.get(display.id).widgetIds.push(w.id);
    }
    for (const { display, widgetIds } of groups.values()) {
      createLockedWindowForDisplay(display, widgetIds);
    }
  };

  ipcMain.handle('widgets:setEnabled', (_event, id, enabled) => {
    aw()[id] = { ...aw()[id], enabled };
    setProfileDirty(true);
    // With the overlay switched off, only remember the choice.
    if (!isProfileEnabled()) return;

    if (id === 'telemetry') {
      if (enabled) showWidget('telemetry');
      else hideWidget('telemetry');
      return;
    }

    if (editModeEnabled) {
      if (enabled) {
        showWidget(id);
      } else {
        hideWidget(id);
      }
    } else {
      // Which monitors need a window can change (e.g. the first widget
      // enabled on a second monitor), so just rebuild the locked set.
      closeLockedWindows();
      createLockedWindows();
    }
  });

  ipcMain.handle('app:version', () => app.getVersion());

  ipcMain.handle('profiles:list', () => ({
    active: settings.activeProfile,
    activeEnabled: isProfileEnabled(),
    dirty: profileDirty,
    names: Object.keys(settings.profiles),
  }));

  ipcMain.handle('profiles:save', () => {
    const name = settings.activeProfile;
    savedSettings.profiles[name] = structuredClone(settings.profiles[name]);
    savedSettings.activeProfile = name;
    schedulePersistSettings();
    setProfileDirty(false);
    return true;
  });

  // Rebuilds every overlay window from the active profile's current state.
  const applyActiveProfile = () => {
    if (editModeEnabled) {
      for (const [id, win] of widgetWindows) {
        if (id === 'telemetry') continue;
        win.close();
        widgetWindows.delete(id);
      }
      closeLockedWindows();
      for (const def of WIDGET_DEFS) {
        if (def.id === 'telemetry') continue;
        if (isWidgetEnabled(def.id) && !widgetWindows.has(def.id))
          createWidgetWindow(def);
      }
    } else {
      closeLockedWindows();
      createLockedWindows();
    }
    if (isWidgetEnabled('telemetry')) {
      if (!widgetWindows.has('telemetry')) showWidget('telemetry');
    } else {
      if (widgetWindows.has('telemetry')) hideWidget('telemetry');
    }
  };

  // Turning the overlay on/off is a runtime switch, not a layout edit, so it
  // persists right away without needing "Salvar".
  ipcMain.handle('profiles:setEnabled', (_e, enabled) => {
    if (!settings.profiles[settings.activeProfile]) return false;
    updateBothSettings((s) => {
      const p = s.profiles[s.activeProfile];
      if (p) p.enabled = enabled;
    });
    applyActiveProfile();
    return true;
  });

  ipcMain.handle('profiles:create', (_e, name) => {
    if (settings.profiles[name]) return false;
    discardUnsavedProfile();
    updateBothSettings((s) => {
      s.profiles[name] = { widgets: {} };
      s.activeProfile = name;
    });
    applyActiveProfile();
    return true;
  });

  ipcMain.handle('profiles:rename', (_e, oldName, newName) => {
    if (!settings.profiles[oldName] || settings.profiles[newName]) return false;
    updateBothSettings((s) => {
      if (s.profiles[oldName]) {
        s.profiles[newName] = s.profiles[oldName];
        delete s.profiles[oldName];
      }
      if (s.activeProfile === oldName) s.activeProfile = newName;
    });
    return true;
  });

  ipcMain.handle('profiles:delete', (_e, name) => {
    const names = Object.keys(settings.profiles);
    if (names.length <= 1 || !settings.profiles[name]) return false;
    if (name === settings.activeProfile) setProfileDirty(false);
    updateBothSettings((s) => {
      delete s.profiles[name];
      if (s.activeProfile === name) {
        s.activeProfile = Object.keys(s.profiles)[0];
      }
    });
    applyActiveProfile();
    return true;
  });

  ipcMain.handle('profiles:switch', (_e, name) => {
    if (!settings.profiles[name]) return false;
    discardUnsavedProfile();
    updateBothSettings((s) => {
      s.activeProfile = name;
    });
    applyActiveProfile();
    return true;
  });

  const createMainWindow = () => {
    mainWindow = new BrowserWindow({
      height: 720,
      width: 960,
      icon: iconPath,
      webPreferences: {
        preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      },
    });
    mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
    if (!app.isPackaged) {
      mainWindow.webContents.openDevTools();
    }
    mainWindow.on('close', (event) => {
      if (!app.isQuitting) {
        event.preventDefault();
        mainWindow.hide();
      }
    });
    mainWindow.on('closed', () => {
      mainWindow = null;
    });
  };

  const createTray = () => {
    const trayIcon = nativeImage
      .createFromPath(iconPath)
      .resize({ width: 16, height: 16 });
    tray = new Tray(trayIcon);
    tray.setToolTip('ACC Telemetry App');
    tray.on('click', () => {
      if (!mainWindow) {
        createMainWindow();
        return;
      }
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    });
    tray.on('right-click', () => {
      const menu = Menu.buildFromTemplate([
        ...(updateDownloaded
          ? [
              {
                label: '↻ Reiniciar para instalar atualização',
                click: () => {
                  app.isQuitting = true;
                  autoUpdater.quitAndInstall();
                },
              },
              { type: 'separator' },
            ]
          : []),
        {
          label: mainWindow?.isVisible()
            ? 'Esconder janela principal'
            : 'Mostrar janela principal',
          click: () => {
            if (!mainWindow) {
              createMainWindow();
            } else if (mainWindow.isVisible()) {
              mainWindow.hide();
            } else {
              mainWindow.show();
              mainWindow.focus();
            }
          },
        },
        {
          label: editModeEnabled
            ? 'Desativar modo edição (F12)'
            : 'Ativar modo edição (F12)',
          click: () => setEditMode(!editModeEnabled),
        },
        { type: 'separator' },
        {
          label: 'Sair',
          click: () => {
            app.isQuitting = true;
            app.quit();
          },
        },
      ]);
      tray.popUpContextMenu(menu);
    });
  };

  app.whenReady().then(() => {
    // No host/port/password screen: we write (or read back) ACC's own
    // broadcasting.json ourselves and connect with whatever's there —
    // the watchdog's periodic re-register means this also just keeps
    // retrying quietly until ACC is actually running.
    const broadcastConfig = ensureBroadcastingConfig();
    broadcastClient.connect({
      host: '127.0.0.1',
      port: broadcastConfig.port,
      displayName: 'ACC Telemetry App',
      connectionPassword: broadcastConfig.connectionPassword,
      commandPassword: broadcastConfig.commandPassword,
    });

    createMainWindow();
    if (isWidgetEnabled('telemetry')) {
      createWidgetWindow(WIDGET_DEFS.find((d) => d.id === 'telemetry'));
    }
    createLockedWindows(); // everything else starts consolidated per monitor
    createTray();
    globalShortcut.register('F12', () => setEditMode(!editModeEnabled));
    if (settings.remote?.enabled) {
      startRemoteServer();
      if (settings.remote?.controller) phoneController.enable();
    }

    if (app.isPackaged) {
      autoUpdater.setFeedURL({
        url: `https://update.electronjs.org/nettocaue/ACC-Telemetry-Overlay-App/win32-x64/${app.getVersion()}`,
        serverType: 'json',
      });
      autoUpdater.on('update-downloaded', (_e, _notes, releaseName) => {
        updateDownloaded = true;
        tray.displayBalloon({
          iconType: 'info',
          title: 'ACC Telemetry App — Atualização pronta',
          content: `Versão ${releaseName} baixada. Clique com botão direito no ícone da bandeja e escolha "Reiniciar para instalar atualização".`,
        });
      });
      autoUpdater.on('error', () => {});
      setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 60_000);
    }

    app.on('activate', () => {
      if (!mainWindow) {
        createMainWindow();
      } else {
        mainWindow.show();
      }
    });
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });

  app.on('before-quit', () => {
    app.isQuitting = true;
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && app.isQuitting) {
      broadcastClient.disconnect();
      sharedMemoryClient.stop();
      phoneController.disable();
      remoteServer.stop();
      app.quit();
    }
  });
}
