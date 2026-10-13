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
const TRACE_WIDTH = 240;
const TRACE_HEIGHT = 110;

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// Builds all three trace paths (gas, brake, steer) in a single pass instead
// of scanning the sample buffer three separate times per render.
function buildTraces(samples, now) {
  let gasD = '';
  let brakeD = '';
  let steerD = '';
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const x = (TRACE_WIDTH - ((now - s.t) / TRACE_WINDOW_MS) * TRACE_WIDTH).toFixed(1);
    const cmd = i === 0 ? 'M' : 'L';
    gasD += `${cmd}${x},${(TRACE_HEIGHT - clamp01(s.gas) * TRACE_HEIGHT).toFixed(1)} `;
    brakeD += `${cmd}${x},${(TRACE_HEIGHT - clamp01(s.brake) * TRACE_HEIGHT).toFixed(1)} `;
    steerD += `${cmd}${x},${(TRACE_HEIGHT - clamp01((s.steerAngle + 1) / 2) * TRACE_HEIGHT).toFixed(1)} `;
  }
  return { gasD, brakeD, steerD };
}

function ScaleBar({ percent, colorClass }) {
  return h('div', { className: 'scalebar' }, [
    h('div', { key: 'top', className: 'scalebar-tick' }, '100'),
    h('div', { key: 'track', className: 'scalebar-track' }, [
      h('div', { key: 'fill', className: `scalebar-fill ${colorClass}`, style: { height: `${percent}%` } }),
    ]),
    h('div', { key: 'bottom', className: 'scalebar-tick' }, '0'),
  ]);
}

function TelemetryWidget() {
  const physics = usePhysics();
  const samplesRef = useRef([]);
  const lastPacketRef = useRef(null);

  // Mutates a plain array in place (push + bounded slice) instead of
  // spreading/filtering a new array on every physics tick — at 60Hz that
  // allocation churn was a real source of the jank/stutter.
  const now = Date.now();
  if (physics && physics.packetId !== lastPacketRef.current) {
    lastPacketRef.current = physics.packetId;
    const arr = samplesRef.current;
    arr.push({ t: now, gas: physics.gas, brake: physics.brake, steerAngle: physics.steerAngle });
    const cutoff = now - TRACE_WINDOW_MS;
    let dropCount = 0;
    while (dropCount < arr.length && arr[dropCount].t < cutoff) dropCount++;
    if (dropCount > 0) samplesRef.current = arr.slice(dropCount);
  }

  const { gasD, brakeD, steerD } = buildTraces(samplesRef.current, now);

  return h('div', { className: 'widget-card telemetry-card' }, [
    h('div', { key: 'accent', className: 'telemetry-accent' }),
    h('div', { key: 'vlabel', className: 'telemetry-vlabel' }, 'TELEMETRY'),
    h(
      'svg',
      {
        key: 'trace',
        className: 'pedal-trace',
        viewBox: `0 0 ${TRACE_WIDTH} ${TRACE_HEIGHT}`,
        preserveAspectRatio: 'none',
      },
      [
        h('path', { key: 'steerLine', d: steerD, className: 'trace-line trace-line-steer' }),
        h('path', { key: 'gasLine', d: gasD, className: 'trace-line trace-line-gas' }),
        h('path', { key: 'brakeLine', d: brakeD, className: 'trace-line trace-line-brake' }),
      ]
    ),
    // Brake on the left, accelerator on the right — matches real pedal layout.
    h(ScaleBar, { key: 'brakeBar', percent: (physics?.brake ?? 0) * 100, colorClass: 'scalebar-brake' }),
    h(ScaleBar, { key: 'gasBar', percent: (physics?.gas ?? 0) * 100, colorClass: 'scalebar-gas' }),
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
