// Phone dash: connects back to the PC app over a WebSocket and renders the
// telemetry snapshots it streams (~30/s). Plain browser JS, no build step —
// the desktop app serves this file as-is.
(() => {
  const TOKEN_KEY = 'acc-dash-token';
  const NUM_LEDS = 15;
  const SHIFT_START = 0.8; // fraction of max RPM where the first LED lights
  const SHIFT_FULL = 0.96; // all LEDs lit
  const SHIFT_BLINK = 0.975; // flash blue: shift now

  const $ = (id) => document.getElementById(id);

  // --- Token / connection --------------------------------------------------

  const params = new URLSearchParams(location.search);
  let token = params.get('t');
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else token = localStorage.getItem(TOKEN_KEY);
  } catch {
    // storage can be unavailable (private mode) — the URL token still works
  }

  const connEl = $('conn');
  const setConn = (state, text) => {
    connEl.className = `conn conn-${state}`;
    connEl.textContent = text;
  };

  let latest = null;
  let dirty = false;
  let retryDelay = 500;
  let socket = null;
  // Phone-controller state from the PC: { enabled, ready, error, busy }
  let controller = { enabled: false, ready: false, error: null, busy: false };
  const onControllerChange = [];
  const onHaptic = [];

  function send(msg) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  function connect() {
    if (!token) {
      setConn('error', 'Sem código');
      showWaiting('Abra pelo QR code mostrado no app do PC.');
      return;
    }
    setConn('connecting', 'Conectando…');
    const ws = new WebSocket(
      `wss://${location.host}/ws?t=${encodeURIComponent(token)}`,
    );
    socket = ws;
    let opened = false;

    ws.onopen = () => {
      opened = true;
      retryDelay = 500;
      setConn('connected', 'Conectado');
    };
    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.type === 'telemetry') {
        latest = msg;
        dirty = true;
      } else if (msg.type === 'haptic') {
        onHaptic.forEach((fn) => fn(msg));
      } else if (msg.type === 'controller') {
        controller = msg;
        onControllerChange.forEach((fn) => fn());
      }
    };
    ws.onclose = () => {
      latest = null;
      dirty = true;
      socket = null;
      controller = { enabled: false, ready: false, error: null, busy: false };
      onControllerChange.forEach((fn) => fn());
      if (!opened && retryDelay >= 4000) {
        // Never got in: most likely an old QR code (token changed).
        setConn('error', 'Sem conexão');
        showWaiting(
          'Não foi possível conectar. Confira se o app está aberto no PC e escaneie o QR code de novo.',
        );
      } else {
        setConn('connecting', 'Reconectando…');
      }
      setTimeout(connect, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 5000);
    };
  }

  // --- Formatting ------------------------------------------------------------

  function formatLap(ms) {
    if (ms == null) return '--:--.---';
    const mins = Math.floor(ms / 60000);
    const secs = Math.floor((ms % 60000) / 1000);
    const millis = Math.floor(ms % 1000);
    return `${mins}:${String(secs).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
  }

  function tyreColor(temp) {
    if (!temp) return '#3a404a';
    if (temp < 70) return '#4488ff';
    if (temp < 95) return '#1adc2a';
    if (temp < 110) return '#f0c000';
    return '#e82020';
  }

  function compoundLabel(str) {
    const s = (str || '').toLowerCase();
    if (s.includes('wet')) return 'CHUVA';
    if (s.includes('dry')) return 'SECO';
    return '';
  }

  const clamp01 = (v) => Math.max(0, Math.min(1, v || 0));

  // Only touch the DOM when a value actually changes.
  const cache = new Map();
  function setText(el, text) {
    if (cache.get(el) === text) return;
    cache.set(el, text);
    el.textContent = text;
  }
  function setClass(el, name, on) {
    el.classList.toggle(name, Boolean(on));
  }

  // --- Static DOM ------------------------------------------------------------

  const ledsEl = $('shift-lights');
  const leds = [];
  for (let i = 0; i < NUM_LEDS; i++) {
    const led = document.createElement('span');
    led.className = 'led';
    ledsEl.appendChild(led);
    leds.push(led);
  }
  const ledColor = (i) =>
    i < NUM_LEDS / 3 ? 'on-green' : i < (NUM_LEDS * 2) / 3 ? 'on-yellow' : 'on-red';

  const tyreEls = [...document.querySelectorAll('.tyre')].map((el) => ({
    el,
    temp: el.querySelector('.tyre-temp'),
    psi: el.querySelector('.tyre-psi'),
  }));

  const dashEl = $('dash');
  function showWaiting(text) {
    setText($('waiting-text'), text);
    dashEl.classList.add('is-waiting');
  }
  function hideWaiting() {
    dashEl.classList.remove('is-waiting');
  }

  // --- Render ----------------------------------------------------------------

  function renderShiftLights(t, now) {
    const ratio = t.maxRpm ? t.rpm / t.maxRpm : 0;
    const blink = ratio >= SHIFT_BLINK && Math.floor(now / 90) % 2 === 0;
    const lit =
      ratio <= SHIFT_START
        ? 0
        : Math.ceil(((ratio - SHIFT_START) / (SHIFT_FULL - SHIFT_START)) * NUM_LEDS);
    leds.forEach((led, i) => {
      const cls =
        ratio >= SHIFT_BLINK
          ? blink
            ? 'led on-blue'
            : 'led'
          : i < lit
            ? `led ${ledColor(i)}`
            : 'led';
      if (led.className !== cls) led.className = cls;
    });
  }

  function renderPedal(name, value) {
    const pct = Math.round(clamp01(value) * 100);
    const bar = $(`bar-${name}`);
    const width = `${pct}%`;
    if (bar.style.width !== width) bar.style.width = width;
    setText($(`val-${name}`), `${pct}%`);
  }

  function render(now) {
    const t = latest;
    if (!t || !t.live) {
      if (connEl.classList.contains('conn-connected')) {
        showWaiting('Aguardando a ACC… entre numa sessão no jogo.');
      }
      // No shared memory at all yet: nothing to draw beyond the hint.
      if (!t || t.gear === undefined) return;
    } else {
      hideWaiting();
    }

    setText(
      $('session-info'),
      [t.track, t.car].filter(Boolean).join(' · ').replace(/_/g, ' '),
    );

    renderShiftLights(t, now);

    // Gear / badges
    const gearEl = $('gear');
    setText(gearEl, t.gear < 0 ? 'R' : t.gear === 0 ? 'N' : String(t.gear));
    setClass(gearEl, 'limiter', t.pitLimiter);
    setClass($('badge-pit'), 'on', t.pitLimiter || t.inPit);
    setClass($('badge-tc'), 'on', t.tcActive);
    setClass($('badge-abs'), 'on', t.absActive);

    setText($('speed'), String(t.speed));
    const wheelGear = $('wheel-gear');
    setText(wheelGear, t.gear < 0 ? 'R' : t.gear === 0 ? 'N' : String(t.gear));
    setClass(wheelGear, 'limiter', t.pitLimiter);
    setText($('wheel-speed'), String(t.speed));
    // Shortcut state shown on the buttons themselves.
    setText($('sc-tc'), t.tc == null ? 'TC -' : `TC ${t.tc}`);
    setText($('sc-abs'), t.abs == null ? 'ABS -' : `ABS ${t.abs}`);
    setClass($('sc-pit'), 'is-on-blue', t.pitLimiter);
    setClass($('sc-ignition'), 'is-on', t.ignition);
    setClass($('sc-starter'), 'is-on', t.engineRunning);
    setClass($('sc-flash'), 'is-on', t.flashing);
    setClass($('sc-pit-request'), 'is-on', t.pitRequested);
    setText($('position'), t.position > 0 ? `P${t.position}` : 'P-');

    // Delta / laps
    const deltaEl = $('delta');
    if (t.delta == null) {
      setText(deltaEl, '--.---');
      setClass(deltaEl, 'faster', false);
      setClass(deltaEl, 'slower', false);
    } else {
      const sign = t.delta > 0 ? '+' : t.delta < 0 ? '−' : '±';
      setText(deltaEl, `${sign}${(Math.abs(t.delta) / 1000).toFixed(3)}`);
      setClass(deltaEl, 'faster', t.delta < 0);
      setClass(deltaEl, 'slower', t.delta > 0);
    }
    setText($('best-lap'), formatLap(t.bestLap));
    setText($('last-lap'), formatLap(t.lastLap));

    const historyKey = JSON.stringify(t.lapHistory);
    const historyEl = $('lap-history');
    if (cache.get(historyEl) !== historyKey) {
      cache.set(historyEl, historyKey);
      historyEl.replaceChildren();
      if (!t.lapHistory.length) {
        const li = document.createElement('li');
        li.className = 'empty';
        li.textContent = 'Nenhuma volta completa ainda';
        historyEl.appendChild(li);
      }
      const best = Math.min(...t.lapHistory.map((l) => l.ms));
      for (const lap of t.lapHistory) {
        const li = document.createElement('li');
        if (lap.ms === best && t.lapHistory.length > 1) li.className = 'is-best';
        const n = document.createElement('span');
        n.className = 'lap-n';
        n.textContent = `Volta ${lap.lap}`;
        const v = document.createElement('span');
        v.textContent = formatLap(lap.ms);
        li.append(n, v);
        historyEl.appendChild(li);
      }
    }

    // Tyres
    setText($('compound'), compoundLabel(t.compound));
    tyreEls.forEach((tyre, i) => {
      const temp = t.tyreTemp[i] || 0;
      setText(tyre.temp, temp ? `${Math.round(temp)}°` : '--°');
      setText(tyre.psi, t.tyrePsi[i] ? `${t.tyrePsi[i].toFixed(1)} psi` : '-- psi');
      const color = tyreColor(temp);
      if (tyre.el.style.borderLeftColor !== color) {
        tyre.el.style.borderLeftColor = color;
        tyre.temp.style.color = temp ? color : '';
      }
    });

    // Fuel
    setText($('fuel'), t.fuel > 0 ? t.fuel.toFixed(1) : '--');
    const fuelLapsEl = $('fuel-laps');
    setText(fuelLapsEl, t.fuelLaps > 0 ? t.fuelLaps.toFixed(1) : '--');
    setClass(fuelLapsEl, 'low', t.fuelLaps > 0 && t.fuelLaps < 2);

    // Pedals + force feedback
    renderPedal('clutch', t.clutch);
    renderPedal('brake', t.brake);
    renderPedal('gas', t.gas);
    renderPedal('ffb', Math.abs(t.ffb));
    setClass($('bar-ffb'), 'clipping', Math.abs(t.ffb) >= 0.99);
  }

  function frame(now) {
    // Shift-light blink needs redraws even without new data.
    const blinking = latest && latest.maxRpm && latest.rpm / latest.maxRpm >= SHIFT_BLINK;
    if (dirty || blinking) {
      dirty = false;
      render(now);
    }
    requestAnimationFrame(frame);
  }

  // --- Fullscreen / landscape / keep screen on --------------------------------

  let wakeLock = null;
  async function keepScreenOn() {
    try {
      if ('wakeLock' in navigator && !wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => {
          wakeLock = null;
        });
      }
    } catch {
      // denied or unsupported — the dash still works, screen may dim
    }
  }

  async function goFullscreen() {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      }
      await screen.orientation?.lock?.('landscape');
    } catch {
      // not supported (e.g. iOS) — ignore
    }
    keepScreenOn();
  }

  $('fullscreen-btn').addEventListener('click', goFullscreen);
  // Wake lock needs a user gesture on some browsers; grab it on first touch.
  document.addEventListener('pointerdown', keepScreenOn, { once: true });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') keepScreenOn();
  });


  // --- Views (Dash / Volante) ------------------------------------------------

  const VIEW_KEY = 'acc-dash-view';
  const views = { dash: $('view-dash'), wheel: $('view-wheel') };
  let currentView = 'dash';
  const onViewChange = [];

  function setView(name) {
    if (!views[name]) return;
    currentView = name;
    for (const [key, el] of Object.entries(views)) el.hidden = key !== name;
    document.querySelectorAll('.tab').forEach((tab) => {
      tab.classList.toggle('is-active', tab.dataset.view === name);
    });
    dashEl.classList.toggle('is-wheel', name === 'wheel');
    try {
      localStorage.setItem(VIEW_KEY, name);
    } catch {
      // ignore
    }
    dirty = true;
    onViewChange.forEach((fn) => fn(name));
  }
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => setView(tab.dataset.view));
  });

  // --- Wheel settings ----------------------------------------------------------

  const SETTINGS_KEY = 'acc-wheel-settings';
  const SLIDERS = [
    {
      key: 'maxAngle',
      label: 'Ângulo para esterço total',
      min: 15,
      max: 90,
      step: 1,
      def: 40,
      fmt: (v) => `${v}°`,
      help: 'Quanto girar o celular para o volante ir até o fim.',
    },
    {
      key: 'steerDeadzone',
      label: 'Zona morta do volante',
      min: 0,
      max: 15,
      step: 0.5,
      def: 2,
      fmt: (v) => `${v}%`,
      help: 'Ignora pequenas tremidas no centro.',
    },
    {
      key: 'steerCurve',
      label: 'Precisão no centro',
      min: 1,
      max: 2.5,
      step: 0.1,
      def: 1.3,
      fmt: (v) => `${Number(v).toFixed(1)}×`,
      help: 'Maior = mais suave perto do centro, mais rápido nas pontas.',
    },
    {
      key: 'smoothing',
      label: 'Suavização',
      min: 0,
      max: 0.9,
      step: 0.05,
      def: 0.4,
      fmt: (v) => `${Math.round(v * 100)}%`,
      help: 'Filtra o ruído do sensor. Muito alto deixa o volante atrasado.',
    },
    {
      key: 'pedalDeadzone',
      label: 'Zona morta dos pedais',
      min: 0,
      max: 20,
      step: 1,
      def: 5,
      fmt: (v) => `${v}%`,
      help: 'Encostar o dedo de leve não acelera nem freia.',
    },
    {
      key: 'shiftTilt',
      label: 'Inclinação para trocar marcha',
      min: 8,
      max: 40,
      step: 1,
      def: 15,
      fmt: (v) => `${v}°`,
      help: 'Quanto inclinar o topo do celular para frente/trás para trocar. Menor = mais fácil.',
    },
  ];
  const TOGGLES = [
    { key: 'shortcuts', label: 'Mostrar atalhos (TC, ABS, pit…)', def: true },
    { key: 'gestureShift', label: 'Trocar marcha com tranco', def: true },
    { key: 'invertShift', label: 'Inverter direção do tranco', def: false },
    { key: 'invertSteer', label: 'Inverter volante', def: false },
    { key: 'vibrate', label: 'Vibrar ao trocar marcha', def: true },
    {
      key: 'hapticTrack',
      label: 'Vibrar com zebra, saída de pista e batidas',
      def: true,
    },
  ];

  const defaults = Object.fromEntries(
    [...SLIDERS, ...TOGGLES].map((d) => [d.key, d.def]),
  );
  let settings = { ...defaults };
  try {
    settings = {
      ...defaults,
      ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'),
    };
  } catch {
    // ignore corrupted storage
  }
  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // ignore
    }
  }

  function buildSettingsUi() {
    const sliderBox = $('settings-sliders');
    sliderBox.replaceChildren();
    for (const def of SLIDERS) {
      const wrap = document.createElement('div');
      wrap.className = 'setting';
      const row = document.createElement('label');
      row.className = 'setting-row';
      const name = document.createElement('span');
      name.textContent = def.label;
      const out = document.createElement('output');
      out.textContent = def.fmt(settings[def.key]);
      row.append(name, out);
      const input = document.createElement('input');
      input.type = 'range';
      input.min = def.min;
      input.max = def.max;
      input.step = def.step;
      input.value = settings[def.key];
      input.addEventListener('input', () => {
        settings[def.key] = Number(input.value);
        out.textContent = def.fmt(settings[def.key]);
        saveSettings();
      });
      const help = document.createElement('div');
      help.className = 'setting-help';
      help.textContent = def.help;
      wrap.append(row, input, help);
      sliderBox.appendChild(wrap);
    }

    const toggleBox = $('settings-toggles');
    toggleBox.replaceChildren();
    for (const def of TOGGLES) {
      const row = document.createElement('label');
      row.className = 'toggle';
      const name = document.createElement('span');
      name.textContent = def.label;
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = Boolean(settings[def.key]);
      input.addEventListener('change', () => {
        settings[def.key] = input.checked;
        saveSettings();
        applyShortcutVisibility();
      });
      row.append(name, input);
      toggleBox.appendChild(row);
    }
  }

  const openSettings = () => {
    buildSettingsUi();
    $('settings').hidden = false;
  };
  $('settings-btn').addEventListener('click', openSettings);
  $('start-settings-btn').addEventListener('click', openSettings);
  $('settings-close').addEventListener('click', () => {
    $('settings').hidden = true;
  });
  $('settings-reset').addEventListener('click', () => {
    const centre = settings.centerOffset;
    settings = { ...defaults, centerOffset: centre };
    saveSettings();
    buildSettingsUi();
    applyShortcutVisibility();
  });

  // --- Steering from motion sensors ---------------------------------------------

  // iOS reports accelerationIncludingGravity with the opposite sign.
  const SENSOR_SIGN = /iPad|iPhone|iPod/.test(navigator.userAgent) ? -1 : 1;
  const gravity = { x: 0, y: 0, z: 0, ok: false };
  let rawAngle = 0; // degrees, right = positive, before centring
  let lastMotionAt = 0;

  function orientationAngle() {
    const a = screen.orientation?.angle ?? window.orientation ?? 0;
    return (((a % 360) + 360) % 360) * (Math.PI / 180);
  }

  // Gear-shift gesture state: tipping the phone's top edge away from you
  // (forward) or towards you. Measured from the gravity vector, so it works
  // on phones without a gyroscope too.
  const pitchState = { pitch: 0, baseline: null, armed: true, anchor: 0, firedAt: 0 };
  let lastShiftAt = 0;

  function onMotion(event) {
    const g = event.accelerationIncludingGravity;
    if (!g || g.x == null) return;
    lastMotionAt = performance.now();

    // Low-pass filter the gravity vector (device coordinates).
    const k = gravity.ok ? 1 - settings.smoothing : 1;
    gravity.x += (g.x * SENSOR_SIGN - gravity.x) * k;
    gravity.y += (g.y * SENSOR_SIGN - gravity.y) * k;
    gravity.z = gravity.ok
      ? gravity.z + ((g.z ?? 0) * SENSOR_SIGN - gravity.z) * 0.5
      : (g.z ?? 0) * SENSOR_SIGN;
    gravity.ok = true;

    // Express "up" in screen coordinates for the current screen rotation.
    const th = orientationAngle();
    const sx = gravity.x * Math.cos(th) - gravity.y * Math.sin(th);
    const sy = gravity.x * Math.sin(th) + gravity.y * Math.cos(th);
    // Phone nearly flat: the in-screen tilt is meaningless, keep last value.
    if (Math.hypot(sx, sy) > 3) {
      // Turning the phone clockwise (right) tips "up" towards screen-left.
      rawAngle = -Math.atan2(sx, sy) * (180 / Math.PI);
    }

    // Pitch: how far the screen faces up (top edge tipped away from you,
    // positive) or down, relative to holding it straight up like a wheel.
    // Independent of the in-screen rotation used for steering.
    const inPlane = Math.hypot(sx, sy);
    const ps = pitchState;
    ps.pitch = Math.atan2(gravity.z, inPlane) * (180 / Math.PI);
    if (!settings.gestureShift || !driving) {
      ps.baseline = null;
      return;
    }
    detectShiftGesture(performance.now());
  }

  function detectShiftGesture(now) {
    const ps = pitchState;
    const threshold = settings.shiftTilt;
    if (ps.baseline === null) {
      ps.baseline = ps.pitch;
      ps.armed = true;
    }
    const delta = ps.pitch - ps.baseline;

    if (ps.armed) {
      if (Math.abs(delta) > threshold && now - lastShiftAt > 300) {
        // Forward (screen tipping up) = shift up.
        let dir = delta > 0 ? 1 : -1;
        if (settings.invertShift) dir = -dir;
        shift(dir);
        ps.armed = false;
        ps.anchor = ps.baseline;
        ps.firedAt = now;
        return;
      }
      // Slowly follow the way the user naturally holds the phone, so a
      // gradual change of posture never counts as a gesture.
      ps.baseline += delta * 0.02;
      return;
    }

    // One tilt = one shift: wait until the phone is back near where it
    // was before the gesture (or the user has settled into a new posture).
    const back = Math.abs(ps.pitch - ps.anchor) < threshold * 0.45;
    if (back || now - ps.firedAt > 2500) {
      ps.armed = true;
      ps.baseline = ps.pitch;
    }
  }

  function steeringValue() {
    let deg = rawAngle - (settings.centerOffset || 0);
    if (deg > 180) deg -= 360;
    if (deg < -180) deg += 360;
    if (settings.invertSteer) deg = -deg;
    let x = Math.max(-1, Math.min(1, deg / settings.maxAngle));
    const dz = settings.steerDeadzone / 100;
    const mag = Math.abs(x);
    x = mag <= dz ? 0 : (Math.sign(x) * (mag - dz)) / (1 - dz);
    return { value: Math.sign(x) * Math.abs(x) ** settings.steerCurve, deg };
  }

  $('center-btn').addEventListener('click', () => {
    settings.centerOffset = rawAngle;
    saveSettings();
  });

  // --- Pedal sliders (multi-touch) -----------------------------------------------

  const pedals = { gas: 0, brake: 0 };
  document.querySelectorAll('.pedal-slider').forEach((el) => {
    const name = el.dataset.pedal;
    const track = el.querySelector('.slider-track');
    const fill = el.querySelector('.slider-fill');
    let pointerId = null;

    const update = (clientY) => {
      const rect = track.getBoundingClientRect();
      // Bottom 8% = released, top 8% = floored: easy to hit both ends.
      const t = (rect.bottom - clientY) / rect.height;
      pedals[name] = Math.max(0, Math.min(1, (t - 0.08) / 0.84));
      fill.style.height = `${pedals[name] * 100}%`;
    };
    const release = () => {
      pointerId = null;
      pedals[name] = 0;
      fill.style.height = '0%';
      el.classList.remove('is-pressed');
    };

    el.addEventListener('pointerdown', (e) => {
      pointerId = e.pointerId;
      el.setPointerCapture(e.pointerId);
      el.classList.add('is-pressed');
      update(e.clientY);
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId === pointerId) update(e.clientY);
    });
    el.addEventListener('pointerup', (e) => {
      if (e.pointerId === pointerId) release();
    });
    el.addEventListener('pointercancel', (e) => {
      if (e.pointerId === pointerId) release();
    });
    el.addEventListener('lostpointercapture', () => release());
  });

  function pedalValue(v) {
    const dz = settings.pedalDeadzone / 100;
    return v <= dz ? 0 : (v - dz) / (1 - dz);
  }

  // --- Shifting --------------------------------------------------------------------

  function shift(dir) {
    if (!driving) return;
    if (!send({ type: 'shift', dir })) return;
    lastShiftAt = performance.now();
    if (settings.vibrate && navigator.vibrate) navigator.vibrate(18);
    const gearEl = $('wheel-gear');
    gearEl.classList.add('flash');
    setTimeout(() => gearEl.classList.remove('flash'), 120);
    const paddle = $(dir > 0 ? 'paddle-up' : 'paddle-down');
    paddle.classList.add('hit');
    setTimeout(() => paddle.classList.remove('hit'), 120);
  }
  $('paddle-up').addEventListener('pointerdown', () => shift(1));
  $('paddle-down').addEventListener('pointerdown', () => shift(-1));

  // --- Track vibration (kerbs, off-track, impacts) ----------------------

  let lastImpactVibeAt = 0;
  onHaptic.push((msg) => {
    if (!driving || !settings.hapticTrack || !navigator.vibrate) return;
    const now = performance.now();
    if (msg.kind === 'impact') {
      lastImpactVibeAt = now;
      navigator.vibrate(msg.ms);
      return;
    }
    // Don't cut an impact buzz short with a kerb tick.
    if (now - lastImpactVibeAt < 400) return;
    if (msg.kind === 'offtrack') navigator.vibrate([30, 25, 30]);
    else navigator.vibrate(msg.ms);
  });

  // --- Shortcut buttons (held while the finger is down) -----------------

  document.querySelectorAll('.shortcut').forEach((btn) => {
    const id = btn.dataset.button;
    let pointerId = null;
    const press = (e) => {
      if (!driving || pointerId !== null) return;
      pointerId = e.pointerId;
      btn.setPointerCapture(e.pointerId);
      btn.classList.add('is-down');
      send({ type: 'button', id, pressed: true });
      if (settings.vibrate && navigator.vibrate) navigator.vibrate(12);
    };
    const release = (e) => {
      if (pointerId === null || (e && e.pointerId !== pointerId)) return;
      pointerId = null;
      btn.classList.remove('is-down');
      send({ type: 'button', id, pressed: false });
    };
    btn.addEventListener('pointerdown', press);
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('lostpointercapture', () => release());
  });

  function applyShortcutVisibility() {
    dashEl.classList.toggle('no-shortcuts', !settings.shortcuts);
  }

  // --- Binding helper ------------------------------------------------------------------

  document.querySelectorAll('[data-bind]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!send({ type: 'bind', target: btn.dataset.bind })) return;
      btn.classList.add('is-running');
      setTimeout(() => btn.classList.remove('is-running'), 1600);
    });
  });

  // --- Driving loop ------------------------------------------------------------------------

  let driving = false;

  function updateWheelStatus() {
    const el = $('wheel-status');
    let text = '';
    let cls = 'wheel-status';
    const sensorsOk = performance.now() - lastMotionAt < 1000;
    if (!socket) {
      text = 'Sem conexão com o PC';
      cls += ' error';
    } else if (!controller.enabled) {
      text = 'Ligue "Usar o celular como volante" no app do PC';
      cls += ' warn';
    } else if (controller.error) {
      text = controller.error;
      cls += ' error';
    } else if (controller.busy) {
      text = 'Outro celular está pilotando';
      cls += ' warn';
    } else if (
      settings.shortcuts &&
      controller.buttonCount > 0 &&
      controller.buttonCount < (controller.buttonsNeeded || 11)
    ) {
      text = `Os atalhos precisam de ${controller.buttonsNeeded || 11} botões no vJoy (hoje: ${controller.buttonCount}). Ajuste no "Configure vJoy".`;
      cls += ' warn';
    } else if (driving && !sensorsOk) {
      text = 'Sensores de movimento não estão respondendo';
      cls += ' error';
    } else if (driving) {
      text = 'Pilotando';
      cls += ' ok';
    }
    if (el.textContent !== text) el.textContent = text;
    if (el.className !== cls) el.className = cls;
    // Same warning on the start screen, where it matters before driving.
    const note = $('start-note');
    const noteText = cls.includes('ok') ? '' : text;
    if (note.textContent !== noteText) note.textContent = noteText;
    note.className = `start-note ${cls.includes('error') ? 'error' : 'warn'}`;
  }
  onControllerChange.push(updateWheelStatus);

  async function startDriving() {
    // iOS 13+ needs an explicit permission prompt from a tap.
    // Some browsers expose the API but never settle it without a prompt UI,
    // so don't wait on it forever.
    try {
      if (typeof DeviceMotionEvent?.requestPermission === 'function') {
        const res = await Promise.race([
          DeviceMotionEvent.requestPermission(),
          new Promise((resolve) => setTimeout(() => resolve('timeout'), 1500)),
        ]);
        if (res === 'denied') {
          $('wheel-start-text').textContent =
            'Sem permissão para os sensores de movimento.';
          return;
        }
      }
    } catch {
      // ignore — we'll notice if no motion events arrive
    }
    window.addEventListener('devicemotion', onMotion);
    goFullscreen();
    driving = true;
    $('wheel-start').hidden = true;
    // First start with no saved centre: whatever position the phone is in
    // now becomes straight ahead.
    setTimeout(() => {
      if (settings.centerOffset == null && gravity.ok) {
        settings.centerOffset = rawAngle;
        saveSettings();
      }
    }, 300);
  }
  $('start-btn').addEventListener('click', startDriving);

  function stopDriving() {
    driving = false;
    window.removeEventListener('devicemotion', onMotion);
    $('wheel-start').hidden = false;
  }
  onViewChange.push((name) => {
    if (name !== 'wheel' && driving) stopDriving();
  });
  document.addEventListener('visibilitychange', () => {
    // Locked screen / switched app: stop sending, the PC releases the pedals.
    if (document.visibilityState !== 'visible' && driving) stopDriving();
  });

  let lastSendAt = 0;
  function wheelFrame(now) {
    if (currentView === 'wheel') {
      const steer = steeringValue();
      const dot = $('steer-dot');
      const left = `${50 + steer.value * 50}%`;
      if (dot.style.left !== left) dot.style.left = left;
      setText($('steer-angle'), `${Math.round(steer.deg)}°`);

      if (driving && controller.ready && !controller.busy && now - lastSendAt >= 15) {
        lastSendAt = now;
        send({
          type: 'input',
          steer: Number(steer.value.toFixed(4)),
          gas: Number(pedalValue(pedals.gas).toFixed(3)),
          brake: Number(pedalValue(pedals.brake).toFixed(3)),
        });
      }
      updateWheelStatus();
    }
    requestAnimationFrame(wheelFrame);
  }

  applyShortcutVisibility();
  connect();
  try {
    setView(localStorage.getItem(VIEW_KEY) || 'dash');
  } catch {
    setView('dash');
  }
  requestAnimationFrame(frame);
  requestAnimationFrame(wheelFrame);
})();
