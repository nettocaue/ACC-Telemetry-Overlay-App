// Le Mans Ultimate telemetry, from the game's own "LMU_Data" shared memory
// (no plugin needed; LMU only publishes it with Settings → Gameplay →
// "Enable Plugins" turned on).
//
// Layout: S397's SharedMemoryInterface.hpp (shipped in the game's
// Support\SharedMemoryInterface folder), as transcribed and verified against
// LMU 1.4 by the MIT-licensed lmu-pitwall project. Byte offsets below were
// computed from that layout with a C compiler (offsetof, #pragma pack(4)).
// Independent implementation.
//
// The block is ~320 KB, so instead of copying it whole every tick we read
// only the slices we use: session info, the occupied scoring slots and the
// player's telemetry record. Like the AMS2 client, it emits ACC-shaped
// payloads so every widget and the phone work unchanged.
import { EventEmitter } from 'node:events';
import { SharedSection } from './sharedSection.js';
import { FuelTracker, rainLevel } from './ams2SharedMemory.js';

export const LMU_SECTION_NAME = 'LMU_Data';
export const LMU_SIZE = 324820; // sizeof(SharedMemoryObjectOut)

const MAX_VEHICLES = 104;
const INT_MAX = 2147483647;
const KELVIN = 273.15;
const KPA_PER_PSI = 6.894757;

// Top-level blocks (offsetof SharedMemoryObjectOut / containers)
const OFF = {
  ffbTorque: 68, // generic.FFBTorque
  scoringInfo: 1632,
  vehScoring: 1632 + 560,
  telemetry: 128464, // activeVehicles, playerVehicleIdx, playerHasVehicle
  telemInfo: 128464 + 4,
};
const SCORING_INFO_SIZE = 548;
const VEH_SCORING_SIZE = 584;
const TELEM_SIZE = 1888;
const WHEEL_SIZE = 260;

// rF2ScoringInfo
const SI = {
  trackName: 0,
  session: 64,
  currentET: 68,
  endET: 76,
  maxLaps: 84,
  lapDist: 88,
  numVehicles: 104,
  gamePhase: 108,
  inRealtime: 115,
  raining: 220,
  ambientTemp: 228,
  trackTemp: 236,
  sessionTimeRemaining: 340,
};

// rF2VehicleScoring
const VS = {
  id: 0,
  driverName: 4,
  vehicleName: 36,
  totalLaps: 100,
  lapDist: 104,
  bestLapTime: 144,
  lastLapTime: 168,
  isPlayer: 196,
  inPits: 198,
  place: 199,
  vehicleClass: 200,
  timeBehindLeader: 244,
  lapsBehindLeader: 252,
  localVel: 288,
  pitState: 457,
};

// rF2VehicleTelemetry
const VT = {
  id: 0,
  elapsedTime: 12,
  lapStartET: 24,
  vehicleName: 32,
  localVel: 184,
  gear: 352,
  engineRPM: 356,
  engineWaterTemp: 364,
  throttle: 420, // filtered
  brake: 428,
  steering: 436,
  clutch: 444,
  fuel: 524,
  engineMaxRPM: 532,
  headlights: 543,
  dentSeverity: 544,
  lastImpactET: 552,
  lastImpactMagnitude: 560,
  speedLimiter: 604,
  fuelCapacity: 608,
  ignitionStarter: 619,
  frontCompoundName: 620,
  deltaBest: 696,
  lapInvalidated: 745,
  absActive: 746,
  tcActive: 747,
  tc: 750,
  tcCut: 754,
  abs: 756,
  motorMap: 758,
  wheels: 848,
};

// rF2Wheel
const WH = {
  brakeTemp: 24,
  pressure: 120,
  temperature: 128, // double[3] left/centre/right, Kelvin
  wear: 152, // 1 = new … 0 = gone
  surfaceType: 176, // 0 dry, 1 wet, 2 grass, 3 dirt, 4 gravel, 5 rumble, 6 special
};
const SURFACE = { GRASS: 2, DIRT: 3, GRAVEL: 4, RUMBLE: 5 };

const SLOW_EVERY = 3; // graphics ~20Hz
const ROSTER_EVERY = 6; // standings ~10Hz

function cString(buf, offset, max) {
  const end = buf.indexOf(0, offset);
  const stop = end === -1 || end > offset + max ? offset + max : end;
  return buf.toString('utf8', offset, stop).trim();
}

const vecLength = (buf, o) =>
  Math.hypot(buf.readDoubleLE(o), buf.readDoubleLE(o + 8), buf.readDoubleLE(o + 16));
const secToMs = (s) => (s > 0 ? Math.round(s * 1000) : INT_MAX);

export function parseLmuScoringInfo(buf) {
  return {
    trackName: cString(buf, SI.trackName, 64),
    session: buf.readInt32LE(SI.session),
    currentET: buf.readDoubleLE(SI.currentET),
    maxLaps: buf.readInt32LE(SI.maxLaps),
    lapDist: buf.readDoubleLE(SI.lapDist),
    numVehicles: buf.readInt32LE(SI.numVehicles),
    gamePhase: buf[SI.gamePhase],
    inRealtime: buf[SI.inRealtime] !== 0,
    raining: buf.readDoubleLE(SI.raining),
    ambientTemp: buf.readDoubleLE(SI.ambientTemp),
    trackTemp: buf.readDoubleLE(SI.trackTemp),
    sessionTimeRemaining: buf.readFloatLE(SI.sessionTimeRemaining),
  };
}

export function parseLmuVehicleScoring(buf, base = 0) {
  return {
    id: buf.readInt32LE(base + VS.id),
    name: cString(buf, base + VS.driverName, 32),
    carName: cString(buf, base + VS.vehicleName, 64),
    totalLaps: buf.readInt16LE(base + VS.totalLaps),
    lapDist: buf.readDoubleLE(base + VS.lapDist),
    bestLapTime: buf.readDoubleLE(base + VS.bestLapTime),
    lastLapTime: buf.readDoubleLE(base + VS.lastLapTime),
    isPlayer: buf[base + VS.isPlayer] !== 0,
    inPits: buf[base + VS.inPits] !== 0,
    place: buf[base + VS.place],
    className: cString(buf, base + VS.vehicleClass, 32),
    timeBehindLeader: buf.readDoubleLE(base + VS.timeBehindLeader),
    lapsBehindLeader: buf.readInt32LE(base + VS.lapsBehindLeader),
    speed: vecLength(buf, base + VS.localVel),
    pitState: buf[base + VS.pitState],
  };
}

export function parseLmuTelemetry(buf) {
  const wheels = [0, 1, 2, 3].map((i) => {
    const w = VT.wheels + i * WHEEL_SIZE;
    const temps = [0, 1, 2].map((k) => buf.readDoubleLE(w + WH.temperature + k * 8));
    return {
      brakeTemp: buf.readDoubleLE(w + WH.brakeTemp) - KELVIN,
      pressureKpa: buf.readDoubleLE(w + WH.pressure),
      temp: temps.reduce((a, b) => a + b, 0) / 3 - KELVIN,
      wear: buf.readDoubleLE(w + WH.wear),
      surface: buf[w + WH.surfaceType],
    };
  });
  const dents = [...buf.subarray(VT.dentSeverity, VT.dentSeverity + 8)];
  return {
    id: buf.readInt32LE(VT.id),
    elapsedTime: buf.readDoubleLE(VT.elapsedTime),
    lapStartET: buf.readDoubleLE(VT.lapStartET),
    vehicleName: cString(buf, VT.vehicleName, 64),
    speed: vecLength(buf, VT.localVel),
    gear: buf.readInt32LE(VT.gear),
    rpm: buf.readDoubleLE(VT.engineRPM),
    waterTemp: buf.readDoubleLE(VT.engineWaterTemp),
    throttle: buf.readDoubleLE(VT.throttle),
    brake: buf.readDoubleLE(VT.brake),
    steering: buf.readDoubleLE(VT.steering),
    clutch: buf.readDoubleLE(VT.clutch),
    fuel: buf.readDoubleLE(VT.fuel),
    maxRpm: buf.readDoubleLE(VT.engineMaxRPM),
    headlights: buf[VT.headlights] !== 0,
    dents,
    lastImpactET: buf.readDoubleLE(VT.lastImpactET),
    lastImpactMagnitude: buf.readDoubleLE(VT.lastImpactMagnitude),
    speedLimiter: buf[VT.speedLimiter] !== 0,
    fuelCapacity: buf.readDoubleLE(VT.fuelCapacity),
    ignitionStarter: buf[VT.ignitionStarter],
    compound: cString(buf, VT.frontCompoundName, 18),
    deltaBest: buf.readDoubleLE(VT.deltaBest),
    lapInvalidated: buf[VT.lapInvalidated] !== 0,
    absActive: buf[VT.absActive] !== 0,
    tcActive: buf[VT.tcActive] !== 0,
    tc: buf[VT.tc],
    tcCut: buf[VT.tcCut],
    abs: buf[VT.abs],
    motorMap: buf[VT.motorMap],
    wheels,
  };
}

export class LmuSharedMemoryClient extends EventEmitter {
  constructor({ section } = {}) {
    super();
    this.section = section ?? new SharedSection(LMU_SECTION_NAME, LMU_SIZE);
    this.timer = null;
    this.tick = 0;
    this.active = false;
    this.lastElapsed = null;
    this.lastStatic = null;
    this.lastRoster = null;
    this.lastCompletedLaps = null;
    this.lastImpactET = null;
    this.impactCount = 0;
    this.impactStrength = 0;
    this.fuel = new FuelTracker();
    this.lastParsed = null; // diagnostics
    this.lastRaw = null;
  }

  start(intervalMs = 16) {
    if (this.timer) return;
    this.timer = setInterval(() => this._tick(), intervalMs);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.section.close();
    this._setActive(false);
  }

  _setActive(active) {
    if (this.active === active) return;
    this.active = active;
    if (!active) {
      this.lastElapsed = null;
      this.lastStatic = null;
      this.lastRoster = null;
    }
    this.emit('active', active);
  }

  _read(offset, size) {
    return this.section.readAt(offset, size);
  }

  _tick() {
    if (!this.section.tryOpen()) return this._setActive(false);
    try {
      const head = this._read(OFF.telemetry, 3);
      const playerIdx = head[1];
      const hasVehicle = head[2] !== 0;
      const infoRaw = this._read(OFF.scoringInfo, SCORING_INFO_SIZE);
      const info = parseLmuScoringInfo(infoRaw);
      if (!hasVehicle || !info.inRealtime || playerIdx >= MAX_VEHICLES) {
        return this._setActive(false);
      }

      const telemRaw = this._read(OFF.telemInfo + playerIdx * TELEM_SIZE, TELEM_SIZE);
      const t = parseLmuTelemetry(telemRaw);
      this._setActive(true);
      this.tick++;

      // Telemetry runs at 100Hz in the game; nothing new = paused.
      const fresh = t.elapsedTime !== this.lastElapsed;
      this.lastElapsed = t.elapsedTime;

      const needScoring = this.tick % SLOW_EVERY === 0 || this.tick % ROSTER_EVERY === 0;
      let vehicles = this.lastVehicles ?? [];
      if (needScoring || !this.lastVehicles) {
        const count = Math.max(0, Math.min(MAX_VEHICLES, info.numVehicles));
        const raw = count ? this._read(OFF.vehScoring, count * VEH_SCORING_SIZE) : Buffer.alloc(0);
        vehicles = [];
        for (let i = 0; i < count; i++) {
          vehicles.push({ slot: i, ...parseLmuVehicleScoring(raw, i * VEH_SCORING_SIZE) });
        }
        this.lastVehicles = vehicles;
      }
      const me = vehicles.find((v) => v.id === t.id) ?? vehicles.find((v) => v.isPlayer);

      this.lastParsed = { info, telemetry: t, player: me ?? null, vehicles };
      this.lastRaw = Buffer.concat([infoRaw, telemRaw]);

      this._emitStatic(info, t);
      if (!fresh) return;
      this._track(t, me);
      this.emit('physics', this._physics(t, info));
      if (this.tick % SLOW_EVERY === 0) this.emit('graphics', this._graphics(t, info, me));
      if (this.tick % ROSTER_EVERY === 0) this._emitRoster(info, vehicles, me, t);
    } catch (err) {
      this.emit('error', err);
    }
  }

  _emitStatic(info, t) {
    const staticData = {
      numCars: info.numVehicles,
      carModel: t.vehicleName,
      track: info.trackName,
      maxRpm: Math.round(t.maxRpm),
      maxFuel: t.fuelCapacity,
    };
    const key = JSON.stringify(staticData);
    if (key === this.lastStatic) return;
    const prev = this.lastStatic ? JSON.parse(this.lastStatic) : null;
    if (!prev || prev.track !== staticData.track || prev.carModel !== staticData.carModel) {
      this.fuel.reset();
      this.lastCompletedLaps = null;
    }
    this.lastStatic = key;
    this.emit('static', staticData);
  }

  _track(t, me) {
    this.fuel.update(t.fuel);
    if (me) {
      const laps = me.totalLaps;
      if (this.lastCompletedLaps !== null && laps < this.lastCompletedLaps) this.fuel.reset();
      else if (this.lastCompletedLaps !== null && laps > this.lastCompletedLaps) {
        this.fuel.onLapCompleted();
      }
      this.lastCompletedLaps = laps;
    }
    // A new impact time = the car hit something (wall, car, barrier).
    if (this.lastImpactET !== null && t.lastImpactET > this.lastImpactET && t.lastImpactMagnitude > 0) {
      this.impactCount++;
      // rF2 impact magnitudes run roughly 0–5000+; map to 0–1.
      this.impactStrength = Math.min(1, t.lastImpactMagnitude / 3000);
    }
    this.lastImpactET = t.lastImpactET;
  }

  // ACC-shaped "physics" payload.
  _physics(t, info) {
    const dent = (i) => (t.dents[i] / 2) * 100;
    const onSurface = (types) => t.wheels.filter((w) => types.includes(w.surface)).length;
    return {
      packetId: Math.round(t.elapsedTime * 1000),
      gas: t.throttle,
      brake: t.brake,
      clutch: t.clutch,
      steerAngle: t.steering,
      fuel: t.fuel,
      gear: t.gear + 1, // rF2: -1 R, 0 N → ACC: 0 R, 1 N
      rpm: Math.round(t.rpm),
      speedKmh: t.speed * 3.6,
      wheelPressure: t.wheels.map((w) => w.pressureKpa / KPA_PER_PSI),
      tyreWear: t.wheels.map((w) => 1 - w.wear),
      tyreWearFrac: t.wheels.map((w) => Math.max(0, 1 - w.wear)),
      tyreCoreTempEarly: t.wheels.map((w) => w.temp),
      tyreCoreTemp: t.wheels.map((w) => w.temp),
      carDamage: { front: 0, rear: 0, left: 0, right: 0, centre: 0 },
      // rF2's 8 dent locations, front first, going round the car.
      damageParts: [
        ['Frente', Math.max(dent(0), dent(1), dent(7))],
        ['Esquerda', dent(2)],
        ['Traseira', Math.max(dent(3), dent(4), dent(5))],
        ['Direita', dent(6)],
      ],
      brakeTemp: t.wheels.map((w) => w.brakeTemp),
      padLife: [0, 0, 0, 0],
      discLife: [0, 0, 0, 0],
      airTemp: info.ambientTemp,
      roadTemp: info.trackTemp,
      waterTemp: t.waterTemp,
      isEngineRunning: t.rpm > 300,
      pitLimiterOn: t.speedLimiter,
      ignitionOn: t.ignitionStarter >= 1,
      starterEngineOn: t.ignitionStarter === 2,
      finalFF: this._ffb(),
      tcInAction: t.tcActive,
      absInAction: t.absActive,
      // For phone vibration
      kerb: onSurface([SURFACE.RUMBLE]) > 0 ? Math.min(1, t.speed / 30) : 0,
      offTrack: onSurface([SURFACE.GRASS, SURFACE.DIRT, SURFACE.GRAVEL]) >= 2,
      impactCount: this.impactCount,
      impactStrength: this.impactStrength,
    };
  }

  _ffb() {
    try {
      return this._read(OFF.ffbTorque, 4).readFloatLE(0);
    } catch {
      return 0;
    }
  }

  // ACC-shaped "graphics" payload.
  _graphics(t, info, me) {
    const current = t.elapsedTime - t.lapStartET;
    const hasBest = (me?.bestLapTime ?? 0) > 0;
    const delta = hasBest && current > 1 ? t.deltaBest : null;
    return {
      packetId: Math.round(t.elapsedTime * 1000),
      completedLaps: me?.totalLaps ?? 0,
      position: me?.place ?? 0,
      iCurrentTime: current > 0 ? Math.round(current * 1000) : 0,
      iLastTime: secToMs(me?.lastLapTime ?? -1),
      iBestTime: secToMs(me?.bestLapTime ?? -1),
      sessionTimeLeft: info.sessionTimeRemaining * 1000,
      isInPit: me?.pitState === 3,
      isInPitLane: Boolean(me?.inPits),
      pitRequested: me?.pitState === 1,
      numberOfLaps: info.maxLaps > 0 && info.maxLaps < 99999 ? info.maxLaps : 0,
      tyreCompound: t.compound,
      windSpeed: 0,
      windDirection: 0,
      rainIntensity: rainLevel(info.raining),
      rainIntensityIn10min: -1,
      rainIntensityIn30min: -1,
      trackGripStatus: -1,
      usedFuel: this.fuel.used,
      tc: t.tc,
      tcCut: t.tcCut,
      engineMap: t.motorMap,
      abs: t.abs,
      flashingLights: t.headlights,
      iDeltaLapTime: delta === null ? 0 : Math.round(Math.abs(delta) * 1000),
      iEstimatedLapTime:
        delta === null ? INT_MAX : Math.round((me.bestLapTime + delta) * 1000),
      isDeltaPositive: delta !== null && delta > 0,
      isValidLap: !t.lapInvalidated,
      fuelEstimatedLaps: this.fuel.estimatedLaps,
      clock: 0,
    };
  }

  // Broadcasting-shaped standings events.
  _emitRoster(info, vehicles, me, t) {
    const classes = [];
    for (const v of vehicles) {
      if (v.className && !classes.includes(v.className)) classes.push(v.className);
    }
    const classPos = new Map();
    for (const cls of classes) {
      vehicles
        .filter((v) => v.className === cls)
        .sort((a, b) => a.place - b.place)
        .forEach((v, i) => classPos.set(v.slot, i + 1));
    }

    this.emit('realtimeUpdate', {
      eventIndex: 0,
      sessionIndex: 0,
      sessionType: info.session,
      phase: info.gamePhase,
      sessionTime: info.currentET,
      sessionEndTime: info.sessionTimeRemaining,
      focusedCarIndex: me ? me.slot : -1,
      activeCameraSet: '',
      activeCamera: '',
      currentHudPage: '',
    });

    const roster = JSON.stringify(vehicles.map((v) => [v.slot, v.id, v.name, v.carName, v.className]));
    if (roster !== this.lastRoster) {
      this.lastRoster = roster;
      this.emit('entryList', { carIndices: vehicles.map((v) => v.slot) });
      for (const v of vehicles) {
        this.emit('entryListCar', {
          carIndex: v.slot,
          carModelType: 0,
          teamName: v.carName,
          raceNumber: null,
          cupCategory: Math.max(0, classes.indexOf(v.className)),
          className: v.className,
          currentDriverIndex: 0,
          nationality: 0,
          drivers: [
            {
              firstName: v.name,
              lastName: '',
              shortName: v.name.split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 3).toUpperCase(),
              category: 0,
              nationality: 0,
            },
          ],
        });
      }
    }

    for (const v of vehicles) {
      const isMe = me && v.slot === me.slot;
      this.emit('realtimeCarUpdate', {
        carIndex: v.slot,
        driverIndex: 0,
        driverCount: 1,
        gear: isMe ? t.gear : 0,
        worldPosX: 0,
        worldPosY: 0,
        yaw: 0,
        carLocation: 0,
        kmh: Math.round((isMe ? t.speed : v.speed) * 3.6),
        position: v.place,
        cupPosition: classPos.get(v.slot) ?? v.place,
        trackPosition: v.place,
        splinePosition: info.lapDist > 0 ? v.lapDist / info.lapDist : 0,
        laps: v.totalLaps,
        // Real gap to the leader (ms); LMU publishes it. Lapped cars: 0.
        delta: v.lapsBehindLeader > 0 ? 0 : Math.round(Math.max(0, v.timeBehindLeader) * 1000),
      });
    }
  }
}
