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

function useGraphics() {
  const [data, setData] = useState(null);
  useEffect(() => window.acc.onGraphics(setData), []);
  return data;
}

function formatMs(ms) {
  if (!ms || ms < 1000) return '--:--.---'; // < 1 s = shared memory not yet populated
  const totalSecs = Math.floor(ms / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  const millis = Math.round(ms % 1000);
  return `${mins}:${String(secs).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

function tyreTempColor(temp) {
  if (temp < 70)  return '#4488ff';
  if (temp < 95)  return '#1adc2a';
  if (temp < 110) return '#f0c000';
  return '#e82020';
}

function rainLabel(intensity) {
  if (intensity < 0.05) return 'Sol';
  if (intensity < 0.25) return 'Nublado';
  if (intensity < 0.6)  return 'Chuva';
  return 'Temporal';
}

function rainColor(intensity) {
  if (intensity < 0.05) return '#f0c000';
  if (intensity < 0.25) return '#aaaaaa';
  if (intensity < 0.6)  return '#4499ff';
  return '#2266cc';
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

const CUP_NAMES  = ['Overall', 'Pro-Am', 'Am', 'Silver', 'National'];
const CUP_COLORS = ['#e8201c', '#ff8c00', '#4499ff', '#aaaaaa', '#44cc88'];

function formatGap(ms) {
  if (!ms || ms <= 0) return '—';
  if (ms < 60000) return `+${(ms / 1000).toFixed(3)}`;
  const m = Math.floor(ms / 60000);
  const s = ((ms % 60000) / 1000).toFixed(3).padStart(6, '0');
  return `+${m}:${s}`;
}

function StandingsWidget() {
  const { cars, entries } = useAllCars();
  const focusedCar = useFocusedCar();
  const focusedIdx = focusedCar?.carIndex;

  const sorted = Object.values(cars)
    .filter((c) => c.position > 0)
    .sort((a, b) => a.position - b.position);

  if (sorted.length === 0) {
    return h('div', { className: 'widget-card widget-card-tall' }, [
      h(WidgetHeader, { key: 'h', label: 'CLASSIFICAÇÃO' }),
      h('div', { key: 'b', className: 'widget-body' },
        h('div', { className: 'standings-empty' }, 'Aguardando dados…')
      ),
    ]);
  }

  // Aggregate all cars per category, preserving position order within each group
  const groupMap = new Map();
  for (const car of sorted) {
    const cat = entries[car.carIndex]?.cupCategory ?? 0;
    if (!groupMap.has(cat)) groupMap.set(cat, []);
    groupMap.get(cat).push(car);
  }
  const groups = [...groupMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([cat, cars]) => ({ cat, cars }));
  const multiClass = groups.length > 1;

  const renderRow = (car) => {
    const entry  = entries[car.carIndex];
    const driver = entry?.drivers?.[entry.currentDriverIndex];
    const name   = driver?.shortName
      || (driver ? `${driver.firstName?.[0] ?? ''}. ${driver.lastName ?? ''}` : '—');
    const isFocused = car.carIndex === focusedIdx;
    const gap = car.position === 1 ? '—' : formatGap(car.delta);
    return h('div', {
      key: car.carIndex,
      className: `standings-row${isFocused ? ' standings-row-me' : ''}`,
    }, [
      h('span', { key: 'pos', className: `standings-pos${car.position <= 3 ? ' standings-pos-top' : ''}` }, car.position),
      h('span', { key: 'name', className: 'standings-name' }, name),
      h('span', { key: 'num',  className: 'standings-num'  }, entry ? `#${entry.raceNumber}` : ''),
      h('span', { key: 'gap',  className: `standings-gap${isFocused ? ' standings-gap-me' : ''}` }, gap),
    ]);
  };

  const items = [];
  for (const { cat, cars: catCars } of groups) {
    if (multiClass) {
      items.push(h('div', {
        key:       `cat-${cat}`,
        className: 'standings-class-hdr',
        style:     { borderLeftColor: CUP_COLORS[cat] ?? '#e8201c' },
      }, CUP_NAMES[cat] ?? `Cat ${cat}`));
    }
    catCars.forEach((car) => items.push(renderRow(car)));
  }

  return h('div', { className: 'widget-card widget-card-tall' }, [
    h(WidgetHeader, { key: 'h', label: 'CLASSIFICAÇÃO' }),
    h('div', { key: 'b', className: 'standings-body' }, items),
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

const GRIP_LABELS = ['Verde', 'Rápida', 'Ótima', 'Oleosa', 'Úmida', 'Molhada', 'Alagada'];
const GRIP_COLORS = ['#1adc2a', '#88cc44', '#44dd88', '#f0c000', '#ff8800', '#4488ff', '#0044ff'];
const WHEEL_LABELS = ['FL', 'FR', 'RL', 'RR'];

function compoundAbbr(str) {
  if (!str) return '';
  const s = str.toLowerCase();
  if (s.includes('wet'))   return 'W';
  if (s.includes('inter')) return 'I';
  if (s.includes('hard'))  return 'H';
  if (s.includes('mediu')) return 'M';
  if (s.includes('soft'))  return 'S';
  if (s.includes('dry'))   return 'D';
  return str[0]?.toUpperCase() ?? '';
}

function TyresWidget() {
  const physics  = usePhysics();
  const graphics = useGraphics();
  const compound = compoundAbbr(graphics?.tyreCompound ?? '');

  if (!physics) {
    return h('div', { className: 'widget-card' }, [
      h(WidgetHeader, { key: 'h', label: 'PNEUS' }),
      h('div', { key: 'b', className: 'widget-body' }, 'Aguardando dados…'),
    ]);
  }

  return h('div', { className: 'widget-card' }, [
    h(WidgetHeader, { key: 'h', label: compound ? `PNEUS — ${compound}` : 'PNEUS' }),
    h('div', { key: 'g', className: 'tyres-grid' },
      WHEEL_LABELS.map((label, i) => {
        const temp  = physics.tyreCoreTemp[i];
        const press = (physics.wheelPressure[i] * 6.895).toFixed(0);
        const wear  = physics.tyreWear[i] != null ? physics.tyreWear[i].toFixed(0) : '--';
        const color = tyreTempColor(temp);
        return h('div', { key: label, className: 'tyre-cell' }, [
          h('div', { key: 'lbl', className: 'tyre-label' }, `${label}${compound ? ' ' + compound : ''}`),
          h('div', { key: 'temp', className: 'tyre-temp', style: { color } }, `${temp.toFixed(0)}°`),
          h('div', { key: 'press', className: 'tyre-pressure' }, `${press} kPa`),
          h('div', { key: 'wear', className: 'tyre-wear' }, `${wear}%`),
        ]);
      })
    ),
  ]);
}

function FuelWidget() {
  const physics  = usePhysics();
  const graphics = useGraphics();

  const fuel = physics?.fuel;
  const usedFuel = graphics?.usedFuel ?? 0;
  const completedLaps = graphics?.completedLaps ?? 0;
  const fuelEst = graphics?.fuelEstimatedLaps;

  // avgPerLap only meaningful when enough fuel has been consumed (>0.1 L)
  const avgPerLap = (completedLaps > 0 && usedFuel > 0.1) ? usedFuel / completedLaps : null;
  const lapsRemaining = avgPerLap && fuel ? fuel / avgPerLap : null;

  const row = (label, value) =>
    h('div', { className: 'fuel-row' }, [
      h('span', { key: 'l', className: 'fuel-label' }, label),
      h('span', { key: 'v', className: 'fuel-value' }, value),
    ]);

  return h('div', { className: 'widget-card' }, [
    h(WidgetHeader, { key: 'h', label: 'COMBUSTÍVEL' }),
    h('div', { key: 'b', className: 'widget-body widget-body-rows' }, [
      row('Restante',    fuel != null && fuel > 0 ? `${fuel.toFixed(1)} L` : '--'),
      row('Média/volta', avgPerLap != null ? `${avgPerLap.toFixed(2)} L` : '--'),
      row('Voltas rest.',lapsRemaining != null ? lapsRemaining.toFixed(1) : '--'),
      row('Est. ACC',    fuelEst != null && fuelEst > 0 ? fuelEst.toFixed(1) : '--'),
      row('Usado stint', usedFuel > 0.1 ? `${usedFuel.toFixed(1)} L` : '--'),
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

function LapTimerWidget() {
  const graphics = useGraphics();

  const pos   = graphics?.position ?? 0;
  const total = graphics?.numberOfLaps ?? 0;
  const laps  = graphics?.completedLaps ?? 0;

  // Only color-code when there's a valid current time to compare
  const hasCurrentTime = graphics?.iCurrentTime >= 1000;
  const curColor = hasCurrentTime
    ? (graphics?.isDeltaPositive ? '#f0c000' : '#1adc2a')
    : undefined;

  const row = (label, value, color) =>
    h('div', { className: 'lap-row' }, [
      h('span', { key: 'l', className: 'lap-label' }, label),
      h('span', { key: 'v', className: 'lap-value', style: color ? { color } : undefined }, value),
    ]);

  return h('div', { className: 'widget-card' }, [
    h('div', { key: 'hdr', className: 'lap-header' }, [
      h('span', { key: 'title', className: 'widget-header-text' }, 'LAP TIMER'),
      pos > 0 && h('span', { key: 'pos', className: 'lap-position' }, `P${pos}${total > 0 ? `/${total}` : ''}`),
    ]),
    h('div', { key: 'body', className: 'widget-body widget-body-rows' }, [
      row('ATUAL',    formatMs(graphics?.iCurrentTime),    curColor),
      row('ÚLTIMA',   formatMs(graphics?.iLastTime),       null),
      row('MELHOR',   formatMs(graphics?.iBestTime),       '#e8201c'),
      row('PREV.',    formatMs(graphics?.iEstimatedLapTime), null),
      row('VOLTAS',   `${laps}${total > 0 ? ` / ${total}` : ''}`, null),
    ]),
  ]);
}

function WeatherWidget() {
  const physics  = usePhysics();
  const graphics = useGraphics();

  const airTemp  = physics?.airTemp;
  const roadTemp = physics?.roadTemp;
  const grip     = graphics?.trackGripStatus ?? 0;
  const gripLabel = GRIP_LABELS[grip] ?? '—';
  const gripColor = GRIP_COLORS[grip] ?? '#f2f2f2';

  const slots = [
    { label: 'AGORA',   val: graphics?.rainIntensity ?? 0 },
    { label: '+10 min', val: graphics?.rainIntensityIn10min ?? 0 },
    { label: '+30 min', val: graphics?.rainIntensityIn30min ?? 0 },
  ];

  return h('div', { className: 'widget-card' }, [
    h('div', { key: 'hdr', className: 'weather-header' }, [
      h('span', { key: 'title', className: 'widget-header-text' }, 'CLIMA'),
      h('span', { key: 'grip', className: 'weather-grip', style: { color: gripColor } }, gripLabel),
    ]),
    h('div', { key: 'temps', className: 'weather-temps' }, [
      h('span', { key: 'air',  className: 'weather-temp-item' }, `Ar ${airTemp > 0 ? airTemp.toFixed(0) : '--'}°C`),
      h('span', { key: 'sep',  className: 'weather-temp-sep'  }, '|'),
      h('span', { key: 'road', className: 'weather-temp-item' }, `Pista ${roadTemp > 0 ? roadTemp.toFixed(0) : '--'}°C`),
    ]),
    h('div', { key: 'forecast', className: 'weather-forecast' },
      slots.map((s) =>
        h('div', { key: s.label, className: 'weather-slot' }, [
          h('div', { key: 'lbl2', className: 'weather-slot-label' }, rainLabel(s.val)),
          h('div', { key: 'pct',  className: 'weather-pct', style: { color: rainColor(s.val) } },
            `${Math.round(s.val * 100)}%`
          ),
          h('div', { key: 'lbl',  className: 'weather-slot-label' }, s.label),
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
  laptimer: LapTimerWidget,
  weather:  WeatherWidget,
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
