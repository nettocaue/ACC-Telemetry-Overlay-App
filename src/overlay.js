import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState } from 'react';
import { createElement as h } from 'react';
import './overlay.css';

const widgetId = new URLSearchParams(window.location.search).get('widget') ?? 'speed';

function useEditMode() {
  const [editMode, setEditMode] = useState(false);
  useEffect(() => {
    window.editMode.get().then(setEditMode);
    return window.editMode.onChanged(setEditMode);
  }, []);
  return editMode;
}

function useFocusedCar() {
  const [car, setCar] = useState(null);
  const [focusedCarIndex, setFocusedCarIndex] = useState(null);
  useEffect(() => {
    const unsubscribers = [
      window.acc.onRealtimeUpdate((data) => setFocusedCarIndex(data.focusedCarIndex)),
      window.acc.onRealtimeCarUpdate((data) => {
        if (data.carIndex === focusedCarIndex) setCar(data);
      }),
    ];
    return () => unsubscribers.forEach((unsub) => unsub());
  }, [focusedCarIndex]);
  return car;
}

function usePhysics() {
  const [physics, setPhysics] = useState(null);
  useEffect(() => window.acc.onPhysics(setPhysics), []);
  return physics;
}

function useStaticTelemetry() {
  const [staticData, setStaticData] = useState(null);
  useEffect(() => window.acc.onStaticTelemetry(setStaticData), []);
  return staticData;
}

function useAllCars() {
  const [cars, setCars] = useState({});
  const [entries, setEntries] = useState({});
  useEffect(() => {
    const unsubscribers = [
      window.acc.onRealtimeCarUpdate((data) => setCars((prev) => ({ ...prev, [data.carIndex]: data }))),
      window.acc.onEntryListCar((data) => setEntries((prev) => ({ ...prev, [data.carIndex]: data }))),
    ];
    return () => unsubscribers.forEach((unsub) => unsub());
  }, []);
  return { cars, entries };
}

function WidgetHeader({ label }) {
  return h('div', { className: 'widget-header' }, label);
}

function SpeedGearWidget() {
  const car = useFocusedCar();
  return h('div', { className: 'widget-card' }, [
    h(WidgetHeader, { key: 'header', label: 'VELOCIDADE' }),
    h('div', { key: 'body', className: 'widget-body' }, [
      h('div', { key: 'speed', className: 'overlay-speed' }, car ? `${car.kmh}` : '--'),
      h('div', { key: 'unit', className: 'overlay-unit' }, 'km/h'),
      h(
        'div',
        { key: 'gear', className: 'overlay-gear' },
        car ? (car.gear === 0 ? 'R' : car.gear === -1 ? 'N' : car.gear) : '-'
      ),
    ]),
  ]);
}

function PositionLapsWidget() {
  const car = useFocusedCar();
  return h('div', { className: 'widget-card' }, [
    h(WidgetHeader, { key: 'header', label: 'POSIÇÃO' }),
    h('div', { key: 'body', className: 'widget-body widget-body-rows' }, [
      h('div', { key: 'pos', className: 'overlay-row' }, [
        h('span', { key: 'l', className: 'row-label' }, 'Posição'),
        h('span', { key: 'v', className: 'row-value' }, `P${car?.position ?? '-'}`),
      ]),
      h('div', { key: 'laps', className: 'overlay-row' }, [
        h('span', { key: 'l', className: 'row-label' }, 'Volta'),
        h('span', { key: 'v', className: 'row-value' }, car?.laps ?? '-'),
      ]),
    ]),
  ]);
}

function StandingsWidget() {
  const { cars, entries } = useAllCars();
  const rows = Object.values(cars)
    .filter((c) => c.position > 0)
    .sort((a, b) => a.position - b.position)
    .slice(0, 10);

  return h('div', { className: 'widget-card widget-card-tall' }, [
    h(WidgetHeader, { key: 'header', label: 'CLASSIFICAÇÃO' }),
    h(
      'div',
      { key: 'body', className: 'standings-body' },
      rows.length === 0
        ? h('div', { className: 'standings-empty' }, 'Aguardando dados…')
        : rows.map((car) => {
            const entry = entries[car.carIndex];
            const driver = entry?.drivers?.[entry.currentDriverIndex];
            const name = driver ? `${driver.firstName?.[0] ?? ''}. ${driver.lastName ?? ''}` : `Carro #${car.carIndex}`;
            return h('div', { key: car.carIndex, className: 'standings-row' }, [
              h('span', { key: 'pos', className: 'standings-pos' }, car.position),
              h('span', { key: 'name', className: 'standings-name' }, name),
              h('span', { key: 'num', className: 'standings-num' }, entry ? `#${entry.raceNumber}` : ''),
              h('span', { key: 'laps', className: 'standings-laps' }, car.laps),
            ]);
          })
    ),
  ]);
}

const TRACE_WINDOW_MS = 5000;

function drawTrace(canvas, samples) {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (samples.length < 2) return;
  const now = Date.now();
  const line = (color, lw, key) => {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const x = w * (1 - (now - s.t) / TRACE_WINDOW_MS);
      const y = h * (1 - Math.max(0, Math.min(1, s[key])));
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  };
  line('#1adc2a', 2,   'gas');
  line('#e82020', 1.5, 'brake');
}

function TelemetryWidget() {
  const canvasRef   = useRef(null);
  const rpmFillRef  = useRef(null);
  const brakeBarRef = useRef(null);
  const gasBarRef   = useRef(null);
  const speedRef    = useRef(null);
  const gearRef     = useRef(null);
  const samplesRef  = useRef([]);
  const rafRef      = useRef(null);
  const staticRef   = useRef(null);

  useEffect(() => window.acc.onStaticTelemetry((d) => { staticRef.current = d; }), []);

  useEffect(() => {
    let lastPacketId = null;
    return window.acc.onPhysics((p) => {
      if (p.packetId === lastPacketId) return;
      lastPacketId = p.packetId;

      const now = Date.now();
      const arr = samplesRef.current;
      arr.push({ t: now, gas: p.gas, brake: p.brake });
      const cutoff = now - TRACE_WINDOW_MS;
      let drop = 0;
      while (drop < arr.length && arr[drop].t < cutoff) drop++;
      if (drop > 0) samplesRef.current = arr.slice(drop);

      // RPM bar — direct DOM write, no React state
      const maxRpm = staticRef.current?.maxRpm ?? 9000;
      if (rpmFillRef.current)
        rpmFillRef.current.style.width = `${Math.min(p.rpm / maxRpm, 1) * 100}%`;

      // Pedal bars
      if (brakeBarRef.current) brakeBarRef.current.style.height = `${p.brake * 100}%`;
      if (gasBarRef.current)   gasBarRef.current.style.height   = `${p.gas   * 100}%`;

      // Speed
      if (speedRef.current)
        speedRef.current.textContent = p.speedKmh != null ? Math.round(p.speedKmh) : '--';

      // Gear — ACC shared memory: 0=R, 1=N, 2=1st, 3=2nd…
      if (gearRef.current) {
        const g = p.gear;
        gearRef.current.textContent = g === 0 ? 'R' : g === 1 ? 'N' : String(g - 1);
      }

      // Canvas trace batched to next animation frame
      if (!rafRef.current)
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          drawTrace(canvasRef.current, samplesRef.current);
        });
    });
  }, []);

  return h('div', { className: 'widget-card telemetry-hud' }, [
    h('div', { key: 'rpm', className: 'rpm-bar' },
      h('div', { ref: rpmFillRef, className: 'rpm-fill', style: { width: '0%' } })
    ),
    h('div', { key: 'body', className: 'telemetry-body' }, [
      h('canvas', { key: 'trace', ref: canvasRef, className: 'pedal-trace' }),
      h('div', { key: 'controls', className: 'telemetry-controls' }, [
        h('div', { key: 'pedals', className: 'pedal-bars' }, [
          h('div', { key: 'b', className: 'pedal-col' }, [
            h('div', { key: 'track', className: 'pedal-track' },
              h('div', { ref: brakeBarRef, className: 'pedal-fill pedal-brake', style: { height: '0%' } })
            ),
            h('span', { key: 'lbl', className: 'pedal-col-label' }, 'F'),
          ]),
          h('div', { key: 'g', className: 'pedal-col' }, [
            h('div', { key: 'track', className: 'pedal-track' },
              h('div', { ref: gasBarRef, className: 'pedal-fill pedal-gas', style: { height: '0%' } })
            ),
            h('span', { key: 'lbl', className: 'pedal-col-label' }, 'A'),
          ]),
        ]),
        h('div', { key: 'readout', className: 'telemetry-readout' }, [
          h('div', { key: 'speed', ref: speedRef, className: 'hud-speed' }, '--'),
          h('div', { key: 'unit',  className: 'hud-unit' }, 'km/h'),
          h('div', { key: 'gear',  ref: gearRef,  className: 'hud-gear'  }, '-'),
        ]),
      ]),
    ]),
  ]);
}

const WHEEL_LABELS = ['FL', 'FR', 'RL', 'RR'];

function TyresWidget() {
  const physics = usePhysics();
  if (!physics) {
    return h('div', { className: 'widget-card' }, [
      h(WidgetHeader, { key: 'header', label: 'PNEUS' }),
      h('div', { key: 'body', className: 'widget-body' }, 'Aguardando dados…'),
    ]);
  }
  return h('div', { className: 'widget-card' }, [
    h(WidgetHeader, { key: 'header', label: 'PNEUS' }),
    h(
      'div',
      { key: 'body', className: 'tyres-grid' },
      WHEEL_LABELS.map((label, i) =>
        h('div', { key: label, className: 'tyre-cell' }, [
          h('div', { key: 'label', className: 'tyre-label' }, label),
          h('div', { key: 'temp', className: 'tyre-temp' }, `${physics.tyreCoreTemp[i].toFixed(0)}°C`),
          h('div', { key: 'press', className: 'tyre-pressure' }, `${physics.wheelPressure[i].toFixed(1)} psi`),
        ])
      )
    ),
  ]);
}

function FuelWidget() {
  const physics = usePhysics();
  const staticData = useStaticTelemetry();
  const fuel = physics?.fuel;
  const maxFuel = staticData?.maxFuel;
  const percent = fuel != null && maxFuel ? Math.round((fuel / maxFuel) * 100) : null;
  return h('div', { className: 'widget-card' }, [
    h(WidgetHeader, { key: 'header', label: 'COMBUSTÍVEL' }),
    h('div', { key: 'body', className: 'widget-body widget-body-rows' }, [
      h('div', { key: 'fuel', className: 'overlay-row' }, [
        h('span', { key: 'l', className: 'row-label' }, 'Restante'),
        h('span', { key: 'v', className: 'row-value' }, fuel != null ? `${fuel.toFixed(1)} kg` : '--'),
      ]),
      h('div', { key: 'percent', className: 'overlay-row' }, [
        h('span', { key: 'l', className: 'row-label' }, 'Nível'),
        h('span', { key: 'v', className: 'row-value' }, percent != null ? `${percent}%` : '--'),
      ]),
    ]),
  ]);
}

function DamageWidget() {
  const physics = usePhysics();
  const damage = physics?.carDamage;
  const parts = [
    ['Frente', damage?.front],
    ['Traseira', damage?.rear],
    ['Esquerda', damage?.left],
    ['Direita', damage?.right],
  ];
  return h('div', { className: 'widget-card' }, [
    h(WidgetHeader, { key: 'header', label: 'DANOS' }),
    h(
      'div',
      { key: 'body', className: 'widget-body widget-body-rows' },
      parts.map(([label, value]) =>
        h('div', { key: label, className: 'overlay-row' }, [
          h('span', { key: 'l', className: 'row-label' }, label),
          h('span', { key: 'v', className: 'row-value' }, value != null ? value.toFixed(1) : '--'),
        ])
      )
    ),
  ]);
}

const WIDGET_COMPONENTS = {
  speed: SpeedGearWidget,
  position: PositionLapsWidget,
  standings: StandingsWidget,
  telemetry: TelemetryWidget,
  tyres: TyresWidget,
  fuel: FuelWidget,
  damage: DamageWidget,
};

function handleResizeMouseDown(e) {
  e.preventDefault();
  e.stopPropagation();
  const startX = e.screenX;
  const startY = e.screenY;
  window.overlay.resizeStart();

  const onMove = (moveEvent) => {
    window.overlay.resizeBy(moveEvent.screenX - startX, moveEvent.screenY - startY);
  };
  const onUp = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

function Overlay() {
  const editMode = useEditMode();
  const Widget = WIDGET_COMPONENTS[widgetId] ?? SpeedGearWidget;

  return h('div', { className: `overlay ${editMode ? 'overlay-editing' : ''}` }, [
    h(Widget, { key: 'content' }),
    editMode && h('div', { key: 'grip', className: 'overlay-resize-grip', onMouseDown: handleResizeMouseDown }),
  ]);
}

// Locked (consolidated) mode: every enabled widget assigned to this
// monitor renders inside this one window, absolutely positioned at its
// saved screen coordinates. This is what's shown whenever edit mode is
// off — one Chromium renderer process per monitor in use instead of one
// per widget.
function LockedOverlay({ originX, originY, ids }) {
  const [widgetList, setWidgetList] = useState([]);

  useEffect(() => {
    const refresh = () => window.widgets.list().then(setWidgetList);
    refresh();
    return window.widgets.onChanged(refresh);
  }, []);

  const idSet = new Set(ids);
  const enabled = widgetList.filter((w) => w.enabled && idSet.has(w.id));

  return h(
    'div',
    { className: 'locked-overlay' },
    enabled.map((w) => {
      const Widget = WIDGET_COMPONENTS[w.id];
      if (!Widget) return null;
      return h(
        'div',
        {
          key: w.id,
          className: 'locked-widget-slot',
          style: {
            left: `${w.x - originX}px`,
            top: `${w.y - originY}px`,
            width: `${w.width}px`,
            height: `${w.height}px`,
          },
        },
        h(Widget)
      );
    })
  );
}

const params = new URLSearchParams(window.location.search);
if (params.get('mode') === 'locked') {
  const originX = Number(params.get('originX')) || 0;
  const originY = Number(params.get('originY')) || 0;
  const ids = (params.get('ids') ?? '').split(',').filter(Boolean);
  createRoot(document.getElementById('root')).render(h(LockedOverlay, { originX, originY, ids }));
} else {
  createRoot(document.getElementById('root')).render(h(Overlay));
}
