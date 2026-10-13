import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, globalShortcut, screen, autoUpdater } from 'electron';
import started from 'electron-squirrel-startup';
import { AccBroadcastClient } from './broadcast/accBroadcastClient.js';
import { AccSharedMemoryClient } from './telemetry/accSharedMemory.js';
import { loadSettings, saveSettings } from './config/settingsStore.js';
import { ensureBroadcastingConfig } from './config/accConfig.js';
import { WIDGET_DEFS } from './widgets/registry.js';
import iconPath from './assets/icon.png';

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
  const broadcastClient = new AccBroadcastClient();
  const sharedMemoryClient = new AccSharedMemoryClient();
  const settings = loadSettings();

  const isWidgetEnabled = (id) => settings.widgets[id]?.enabled !== false;

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
  const PHYSICS_SLOW_WIDGET_IDS = ['tyres', 'fuel', 'damage'];
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

  broadcastClient.on('connected', (data) => broadcastToWindows('acc:connected', data));
  broadcastClient.on('registrationFailed', (msg) => broadcastToWindows('acc:registrationFailed', msg));
  broadcastClient.on('realtimeUpdate', (data) => broadcastToWindows('acc:realtimeUpdate', data));
  broadcastClient.on('realtimeCarUpdate', (data) => broadcastToWindows('acc:realtimeCarUpdate', data));
  broadcastClient.on('entryList', (data) => broadcastToWindows('acc:entryList', data));
  broadcastClient.on('entryListCar', (data) => broadcastToWindows('acc:entryListCar', data));
  broadcastClient.on('trackData', (data) => broadcastToWindows('acc:trackData', data));
  broadcastClient.on('broadcastingEvent', (data) => broadcastToWindows('acc:broadcastingEvent', data));
  broadcastClient.on('error', (err) => broadcastToWindows('acc:error', err.message));
  broadcastClient.on('parseError', (err) => broadcastToWindows('acc:parseError', err.message));
  broadcastClient.on('reregistering', () => broadcastToWindows('acc:reregistering', null));

  sharedMemoryClient.on('physics', (data) => sendToPhysicsWidgets('acc:physics', data));
  sharedMemoryClient.on('static', (data) => sendToAllPhysicsWidgets('acc:staticTelemetry', data));
  sharedMemoryClient.on('error', (err) => broadcastToWindows('acc:sharedMemoryError', err.message));
  sharedMemoryClient.start(16); // ~60Hz — matches frame rate, minimizes pedal/RPM trace lag

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
    savePositionTimeout = setTimeout(() => saveSettings(settings), 400);
  };

  // Editing uses one native OS window per widget (easy to drag/resize
  // independently, including across monitors). Once the user is done, every
  // widget except Telemetry collapses into one shared window per monitor —
  // Telemetry keeps its own dedicated window/process permanently, in both
  // modes, because it's the only widget that needs real 60Hz updates; piling
  // it into the shared window made it compete for the same thread as
  // everything else and brought the jank right back.
  const setEditMode = (enabled) => {
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
        if (isWidgetEnabled(def.id)) createWidgetWindow(def);
      }
    } else {
      for (const [id, win] of [...widgetWindows]) {
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
    const saved = settings.widgets[def.id] ?? {};
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
      settings.widgets[def.id] = { ...settings.widgets[def.id], x, y, width, height };
      schedulePersistSettings();
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
      const shouldRespawn = def.id === 'telemetry' ? isWidgetEnabled(def.id) : editModeEnabled && isWidgetEnabled(def.id);
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
      const saved = settings.widgets[def.id] ?? {};
      return {
        id: def.id,
        title: def.title,
        enabled: isWidgetEnabled(def.id),
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
    for (const win of lockedWindows) win.close();
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
    win.loadURL(`${OVERLAY_WINDOW_WEBPACK_ENTRY}?mode=locked&originX=${x}&originY=${y}&ids=${widgetIds.join(',')}`);
    win.setIgnoreMouseEvents(true);

    let exitHandled = false;
    const handleUnexpectedExit = () => {
      if (exitHandled) return;
      exitHandled = true;
      lockedWindows = lockedWindows.filter((w) => w !== win);
      if (!editModeEnabled) {
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
    const enabledWidgets = getWidgetListWithGeometry().filter((w) => w.enabled && w.id !== 'telemetry');
    const groups = new Map(); // display.id -> { display, widgetIds }
    for (const w of enabledWidgets) {
      const display = screen.getDisplayNearestPoint({
        x: Math.round(w.x + w.width / 2),
        y: Math.round(w.y + w.height / 2),
      });
      if (!groups.has(display.id)) groups.set(display.id, { display, widgetIds: [] });
      groups.get(display.id).widgetIds.push(w.id);
    }
    for (const { display, widgetIds } of groups.values()) {
      createLockedWindowForDisplay(display, widgetIds);
    }
  };

  ipcMain.handle('widgets:setEnabled', (_event, id, enabled) => {
    settings.widgets[id] = { ...settings.widgets[id], enabled };
    schedulePersistSettings();

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
    const trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
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
        ...(updateDownloaded ? [
          {
            label: '↻ Reiniciar para instalar atualização',
            click: () => { app.isQuitting = true; autoUpdater.quitAndInstall(); },
          },
          { type: 'separator' },
        ] : []),
        {
          label: mainWindow?.isVisible() ? 'Esconder janela principal' : 'Mostrar janela principal',
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
          label: editModeEnabled ? 'Desativar modo edição (F12)' : 'Ativar modo edição (F12)',
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
      // Verifica 1 minuto após o início para não atrasar o startup
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
      app.quit();
    }
  });
}
