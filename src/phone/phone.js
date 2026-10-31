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
      }
    };
    ws.onclose = () => {
      latest = null;
      dirty = true;
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

  connect();
  requestAnimationFrame(frame);
})();
