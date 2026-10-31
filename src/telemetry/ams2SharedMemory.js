// Automobilista 2 telemetry, read from the game's "$pcars2$" shared memory
// (AMS2 must have Options → System → Shared Memory set to "Project CARS 2").
//
// Layout: Reiza's SharedMemory.h, version 14 (shipped with the game in
// Support/SharedMemory). Byte offsets below were computed from that header
// with a C compiler (offsetof) — plain 4-byte ints/floats, 1-byte bools and
// char arrays, so the layout is the same under MSVC x64. Independent
// implementation; no code from the header or other projects is included.
//
// Instead of a separate data model, this client emits the same events and
// payload shapes as the ACC clients (physics / static / graphics from shared
// memory, realtimeUpdate / realtimeCarUpdate / entryList* from broadcasting),
// so every overlay widget and the phone dash work unchanged. Values ACC has
// and AMS2 doesn't (force feedback, rain forecast, track grip…) are left at
// "unknown"; things AMS2 doesn't provide but we can work out (live delta,
// fuel per lap) are computed here.
import { EventEmitter } from 'node:events';
import { SharedSection } from './sharedSection.js';

export const AMS2_SECTION_NAME = '$pcars2$';
export const AMS2_SUPPORTED_VERSION = 14;
export const AMS2_SIZE = 20700; // sizeof(SharedMemory), v14

const STRING_MAX = 64;
const PARTICIPANTS_MAX = 64;
const PARTICIPANT_SIZE = 100;
const COMPOUND_NAME_MAX = 40;
const INT_MAX = 2147483647;

// offsetof(ParticipantInfo, …)
const P = {
  isActive: 0,
  name: 1,
  lapDistance: 80,
  racePosition: 84,
  lapsCompleted: 88,
  currentLap: 92,
};

// offsetof(SharedMemory, …)
const O = {
  version: 0,
  gameState: 8,
  sessionState: 12,
  viewedParticipantIndex: 20,
  numParticipants: 24,
  participantInfo: 28,
  carName: 6444,
  carClassName: 6508,
  lapsInEvent: 6572,
  trackLocation: 6576,
  trackVariation: 6640,
  trackLength: 6704,
  lapInvalidated: 6712,
  bestLapTime: 6716,
  lastLapTime: 6720,
  currentTime: 6724,
  eventTimeRemaining: 6740,
  pitMode: 6808,
  pitSchedule: 6812,
  carFlags: 6816,
  waterTemp: 6828,
  fuelLevel: 6840,
  fuelCapacity: 6844,
  speed: 6848,
  rpm: 6852,
  maxRpm: 6856,
  brake: 6860,
  throttle: 6864,
  clutch: 6868,
  steering: 6872,
  gear: 6876,
  antiLockActive: 6888,
  lastCollisionIndex: 6892,
  lastCollisionMagnitude: 6896,
  terrain: 7008,
  tyreTemp: 7072,
  tyreWear: 7136,
  suspensionDamage: 7168,
  brakeTemp: 7184,
  aeroDamage: 7284,
  engineDamage: 7288,
  ambientTemp: 7292,
  trackTemp: 7296,
  rainDensity: 7300,
  windSpeed: 7304,
  sequenceNumber: 7320,
  airPressure: 7372,
  speeds: 10800,
  carNames: 11056,
  carClassNames: 15152,
  tyreCompound: 19388,
  antiLockSetting: 20660,
  tractionControlSetting: 20664,
};

// Enums from SharedMemory.h
const GAME_INGAME_PLAYING = 2;
const GAME_INGAME_PAUSED = 3;
const GAME_INGAME_INMENU_TIME_TICKING = 4;
const GAME_INGAME_RESTARTING = 5;
const IN_GAME_STATES = new Set([
  GAME_INGAME_PLAYING,
  GAME_INGAME_PAUSED,
  GAME_INGAME_INMENU_TIME_TICKING,
  GAME_INGAME_RESTARTING,
]);
const PIT_MODE = {
  DRIVING_INTO_PITS: 1,
  IN_PIT: 2,
  DRIVING_OUT_OF_PITS: 3,
  IN_GARAGE: 4,
  DRIVING_OUT_OF_GARAGE: 5,
};
const CAR_FLAG = {
  HEADLIGHT: 1 << 0,
  ENGINE_ACTIVE: 1 << 1,
  SPEED_LIMITER: 1 << 3,
  TCS: 1 << 6,
};

// Terrain enum values (Type#11) for phone vibration.
const RUMBLE_TERRAIN = new Set([10, 25, 40, 41]);
const OFFTRACK_TERRAIN = new Set([6, 7, 8, 9, 15, 16, 17, 18, 22, 24, 27, 28, 32, 42, 43]);

const SLOW_EVERY = 3; // graphics at ~20Hz
const ROSTER_EVERY = 6; // standings at ~10Hz (same as ACC broadcasting)
const DELTA_SAMPLE_METRES = 5;

function cString(buf, offset, max) {
  const end = buf.indexOf(0, offset);
  const stop = end === -1 || end > offset + max ? offset + max : end;
  // AMS2 strings are UTF-8 (driver names can have accents).
  return buf.toString('utf8', offset, stop).trim();
}

const f32 = (buf, o) => buf.readFloatLE(o);
const i32 = (buf, o) => buf.readInt32LE(o);
const u32 = (buf, o) => buf.readUInt32LE(o);
const f32x4 = (buf, o) => [0, 1, 2, 3].map((i) => buf.readFloatLE(o + i * 4));
const secToMs = (s) => (s > 0 ? Math.round(s * 1000) : INT_MAX);

// AMS2 has rain density (0–1); widgets expect ACC's 0–5 rain intensity.
export function rainLevel(density) {
  if (!(density > 0.01)) return 0;
  if (density < 0.1) return 1;
  if (density < 0.3) return 2;
  if (density < 0.55) return 3;
  if (density < 0.8) return 4;
  return 5;
}

// Parses everything the app uses from one snapshot of the shared memory.
export function parseAms2(buf) {
  const participants = [];
  const num = Math.max(0, Math.min(PARTICIPANTS_MAX, i32(buf, O.numParticipants)));
  for (let i = 0; i < num; i++) {
    const base = O.participantInfo + i * PARTICIPANT_SIZE;
    if (!buf[base + P.isActive]) continue;
    participants.push({
      index: i,
      name: cString(buf, base + P.name, STRING_MAX),
      lapDistance: f32(buf, base + P.lapDistance),
      racePosition: u32(buf, base + P.racePosition),
      lapsCompleted: u32(buf, base + P.lapsCompleted),
      currentLap: u32(buf, base + P.currentLap),
      speed: f32(buf, O.speeds + i * 4),
      carName: cString(buf, O.carNames + i * STRING_MAX, STRING_MAX),
      className: cString(buf, O.carClassNames + i * STRING_MAX, STRING_MAX),
    });
  }

  return {
    version: u32(buf, O.version),
    sequence: u32(buf, O.sequenceNumber),
    gameState: u32(buf, O.gameState),
    sessionState: u32(buf, O.sessionState),
    viewedIndex: i32(buf, O.viewedParticipantIndex),
    participants,
    carName: cString(buf, O.carName, STRING_MAX),
    carClassName: cString(buf, O.carClassName, STRING_MAX),
    lapsInEvent: u32(buf, O.lapsInEvent),
    trackLocation: cString(buf, O.trackLocation, STRING_MAX),
    trackVariation: cString(buf, O.trackVariation, STRING_MAX),
    trackLength: f32(buf, O.trackLength),
    lapInvalidated: buf[O.lapInvalidated] !== 0,
    bestLapTime: f32(buf, O.bestLapTime),
    lastLapTime: f32(buf, O.lastLapTime),
    currentTime: f32(buf, O.currentTime),
    eventTimeRemaining: f32(buf, O.eventTimeRemaining),
    pitMode: u32(buf, O.pitMode),
    pitSchedule: u32(buf, O.pitSchedule),
    carFlags: u32(buf, O.carFlags),
    waterTemp: f32(buf, O.waterTemp),
    fuelLevel: f32(buf, O.fuelLevel),
    fuelCapacity: f32(buf, O.fuelCapacity),
    speed: f32(buf, O.speed),
    rpm: f32(buf, O.rpm),
    maxRpm: f32(buf, O.maxRpm),
    brake: f32(buf, O.brake),
    throttle: f32(buf, O.throttle),
    clutch: f32(buf, O.clutch),
    steering: f32(buf, O.steering),
    gear: i32(buf, O.gear),
    antiLockActive: buf[O.antiLockActive] !== 0,
    lastCollisionIndex: i32(buf, O.lastCollisionIndex),
    lastCollisionMagnitude: f32(buf, O.lastCollisionMagnitude),
    terrain: [0, 1, 2, 3].map((i) => u32(buf, O.terrain + i * 4)),
    tyreTemp: f32x4(buf, O.tyreTemp),
    tyreWear: f32x4(buf, O.tyreWear),
    suspensionDamage: f32x4(buf, O.suspensionDamage),
    brakeTemp: f32x4(buf, O.brakeTemp),
    aeroDamage: f32(buf, O.aeroDamage),
    engineDamage: f32(buf, O.engineDamage),
    ambientTemp: f32(buf, O.ambientTemp),
    trackTemp: f32(buf, O.trackTemp),
    rainDensity: f32(buf, O.rainDensity),
    windSpeed: f32(buf, O.windSpeed),
    airPressure: f32x4(buf, O.airPressure),
    tyreCompound: cString(buf, O.tyreCompound, COMPOUND_NAME_MAX),
    antiLockSetting: i32(buf, O.antiLockSetting),
    tractionControlSetting: i32(buf, O.tractionControlSetting),
  };
}

// Live delta to the best valid lap of this session, from distance/time
// samples (AMS2 doesn't publish a delta of its own).
class DeltaTracker {
  constructor() {
    this.reset();
  }

  reset() {
    this.samples = [];
    this.reference = null; // { lapTime, samples }
    this.lapValid = true;
  }

  onLapCompleted(lastLapTime) {
    if (
      this.lapValid &&
      lastLapTime > 0 &&
      this.samples.length > 20 &&
      (!this.reference || lastLapTime < this.reference.lapTime)
    ) {
      this.reference = { lapTime: lastLapTime, samples: this.samples };
    }
    this.samples = [];
    this.lapValid = true;
  }

  update(distance, time, invalidated) {
    if (invalidated) this.lapValid = false;
    if (!(distance >= 0) || !(time > 0)) return;
    const last = this.samples[this.samples.length - 1];
    if (!last || distance - last[0] >= DELTA_SAMPLE_METRES) {
      this.samples.push([distance, time]);
    }
  }

  // Seconds ahead (negative) / behind (positive) the reference lap, or null.
  delta(distance, time) {
    const ref = this.reference?.samples;
    if (!ref || !(distance > 30) || !(time > 0)) return null;
    let lo = 0;
    let hi = ref.length - 1;
    if (distance > ref[hi][0]) return null;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (ref[mid][0] <= distance) lo = mid;
      else hi = mid;
    }
    const [d0, t0] = ref[lo];
    const [d1, t1] = ref[hi];
    const refTime = d1 > d0 ? t0 + ((distance - d0) / (d1 - d0)) * (t1 - t0) : t0;
    return time - refTime;
  }
}

// Fuel used this stint and average per lap (AMS2 only gives the tank level).
export class FuelTracker {
  constructor() {
    this.reset();
  }

  reset() {
    this.stintStart = null;
    this.lapStart = null;
    this.perLap = [];
    this.last = null;
  }

  update(litres) {
    if (!(litres >= 0)) return;
    // Refuelled (or car reset): start a new stint.
    if (this.last !== null && litres > this.last + 0.5) {
      this.stintStart = litres;
      this.lapStart = null;
    }
    if (this.stintStart === null) this.stintStart = litres;
    this.last = litres;
  }

  onLapCompleted() {
    if (this.lapStart !== null && this.last !== null) {
      const used = this.lapStart - this.last;
      if (used > 0.05) {
        this.perLap.push(used);
        if (this.perLap.length > 3) this.perLap.shift();
      }
    }
    this.lapStart = this.last;
  }

  get used() {
    return this.stintStart !== null && this.last !== null
      ? Math.max(0, this.stintStart - this.last)
      : 0;
  }

  get estimatedLaps() {
    if (!this.perLap.length || this.last === null) return 0;
    const avg = this.perLap.reduce((a, b) => a + b, 0) / this.perLap.length;
    return this.last / avg;
  }
}

export class Ams2SharedMemoryClient extends EventEmitter {
  constructor({ section } = {}) {
    super();
    this.section = section ?? new SharedSection(AMS2_SECTION_NAME, AMS2_SIZE);
    this.timer = null;
    this.tick = 0;
    this.active = false;
    this.lastSequence = null;
    this.lastStatic = null;
    this.lastRoster = null;
    this.lastCompletedLaps = null;
    this.warnedVersion = null;
    this.delta = new DeltaTracker();
    this.fuel = new FuelTracker();
    this.lastRaw = null; // for the diagnostics dump
    this.lastParsed = null;
    this.impactCount = 0;
    this.impactStrength = 0;
    this.lastCollisionMagnitude = null;
    this.lastDamage = null;
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
      this.lastSequence = null;
      this.lastStatic = null;
      this.lastRoster = null;
    }
    this.emit('active', active);
  }

  _tick() {
    if (!this.section.tryOpen()) return this._setActive(false);
    try {
      // Check the version before reading the whole struct: an older game
      // build publishes a smaller block, and reading past it would crash.
      const version = this.section.read(4).readUInt32LE(0);
      if (version !== AMS2_SUPPORTED_VERSION) {
        if (version !== 0 && this.warnedVersion !== version) {
          this.warnedVersion = version;
          this.emit(
            'error',
            new Error(
              `Versão da memória compartilhada do AMS2 não suportada (${version}, esperado ${AMS2_SUPPORTED_VERSION}). Atualize o app ou o jogo.`,
            ),
          );
        }
        return this._setActive(false);
      }

      const buf = this.section.read(AMS2_SIZE);
      const d = parseAms2(buf);
      // Odd sequence number = the game is mid-write; try again next tick.
      if (d.sequence % 2 === 1) return;
      if (!IN_GAME_STATES.has(d.gameState) || d.viewedIndex < 0) {
        return this._setActive(false);
      }
      this._setActive(true);
      this.lastRaw = buf;
      this.lastParsed = d;
      this.tick++;

      this._emitStatic(d);
      if (d.sequence === this.lastSequence) return; // paused / no new frame
      this.lastSequence = d.sequence;

      const me = d.participants.find((p) => p.index === d.viewedIndex);
      this._trackLaps(d, me);
      this._trackImpacts(d);
      this.emit('physics', this._physics(d));
      if (this.tick % SLOW_EVERY === 0) this.emit('graphics', this._graphics(d, me));
      if (this.tick % ROSTER_EVERY === 0) this._emitRoster(d);
    } catch (err) {
      this.emit('error', err);
    }
  }

  _emitStatic(d) {
    const track = [d.trackLocation, d.trackVariation].filter(Boolean).join(' ');
    const staticData = {
      numCars: d.participants.length,
      carModel: d.carName,
      track,
      maxRpm: Math.round(d.maxRpm),
      maxFuel: d.fuelCapacity,
    };
    const key = JSON.stringify(staticData);
    if (key === this.lastStatic) return;
    // New car or track: old delta reference and fuel figures don't apply.
    const prev = this.lastStatic ? JSON.parse(this.lastStatic) : null;
    if (!prev || prev.track !== track || prev.carModel !== d.carName) {
      this.delta.reset();
      this.fuel.reset();
      this.lastCompletedLaps = null;
    }
    this.lastStatic = key;
    this.emit('static', staticData);
  }

  _trackLaps(d, me) {
    const fuelLitres = d.fuelLevel * d.fuelCapacity;
    this.fuel.update(fuelLitres);
    if (!me) return;
    const laps = me.lapsCompleted;
    if (this.lastCompletedLaps !== null && laps < this.lastCompletedLaps) {
      // Session restarted.
      this.delta.reset();
      this.fuel.reset();
    } else if (this.lastCompletedLaps !== null && laps > this.lastCompletedLaps) {
      this.delta.onLapCompleted(d.lastLapTime);
      this.fuel.onLapCompleted();
    }
    this.lastCompletedLaps = laps;
    this.delta.update(me.lapDistance, d.currentTime, d.lapInvalidated);
  }

  // Contact with another car (AMS2 reports its magnitude) or new damage
  // from hitting anything else → one "impact" for the phone to vibrate.
  _trackImpacts(d) {
    const damage =
      d.aeroDamage + d.engineDamage + d.suspensionDamage.reduce((a, b) => a + b, 0);
    let strength = 0;
    if (
      this.lastCollisionMagnitude !== null &&
      d.lastCollisionMagnitude > 0 &&
      d.lastCollisionMagnitude !== this.lastCollisionMagnitude
    ) {
      strength = Math.min(1, d.lastCollisionMagnitude / 1500);
    }
    if (this.lastDamage !== null && damage > this.lastDamage + 0.005) {
      strength = Math.max(strength, Math.min(1, (damage - this.lastDamage) * 8));
    }
    if (strength > 0) {
      this.impactCount++;
      this.impactStrength = Math.max(0.2, strength);
    }
    this.lastCollisionMagnitude = d.lastCollisionMagnitude;
    this.lastDamage = damage;
  }

  // ACC-shaped "physics" payload (see accSharedMemory.js parsePhysics).
  _physics(d) {
    const flags = d.carFlags;
    const engineOn = (flags & CAR_FLAG.ENGINE_ACTIVE) !== 0;
    const [sFL, sFR, sRL, sRR] = d.suspensionDamage;
    return {
      packetId: d.sequence,
      gas: d.throttle,
      brake: d.brake,
      clutch: d.clutch,
      steerAngle: d.steering,
      fuel: d.fuelLevel * d.fuelCapacity,
      gear: d.gear + 1, // AMS2: -1 R, 0 N, 1… → ACC: 0 R, 1 N, 2…
      rpm: Math.round(d.rpm),
      speedKmh: d.speed * 3.6,
      wheelPressure: d.airPressure,
      tyreWear: d.tyreWear,
      tyreWearFrac: d.tyreWear, // real wear (ACC doesn't publish it)
      tyreCoreTempEarly: d.tyreTemp,
      tyreCoreTemp: d.tyreTemp,
      carDamage: { front: 0, rear: 0, left: 0, right: 0, centre: 0 },
      // Damage AMS2 actually reports, already labelled for the widget.
      damageParts: [
        ['Aerodinâmica', d.aeroDamage * 100],
        ['Motor', d.engineDamage * 100],
        ['Suspensão esq.', Math.max(sFL, sRL) * 100],
        ['Suspensão dir.', Math.max(sFR, sRR) * 100],
      ],
      brakeTemp: d.brakeTemp,
      padLife: [0, 0, 0, 0],
      discLife: [0, 0, 0, 0],
      airTemp: d.ambientTemp,
      roadTemp: d.trackTemp,
      waterTemp: d.waterTemp,
      isEngineRunning: engineOn,
      pitLimiterOn: (flags & CAR_FLAG.SPEED_LIMITER) !== 0,
      ignitionOn: engineOn,
      starterEngineOn: false,
      finalFF: 0, // AMS2 doesn't publish force feedback
      tcInAction: (flags & CAR_FLAG.TCS) !== 0,
      absInAction: d.antiLockActive,
      // For phone vibration
      kerb: d.terrain.some((t) => RUMBLE_TERRAIN.has(t)) ? Math.min(1, d.speed / 30) : 0,
      offTrack: d.terrain.filter((t) => OFFTRACK_TERRAIN.has(t)).length >= 2,
      impactCount: this.impactCount,
      impactStrength: this.impactStrength,
    };
  }

  // ACC-shaped "graphics" payload (see accSharedMemory.js parseGraphics).
  _graphics(d, me) {
    const distance = me?.lapDistance ?? 0;
    const delta = this.delta.delta(distance, d.currentTime);
    const bestMs = secToMs(d.bestLapTime);
    const rain = rainLevel(d.rainDensity);
    return {
      packetId: d.sequence,
      completedLaps: me?.lapsCompleted ?? 0,
      position: me?.racePosition ?? 0,
      iCurrentTime: d.currentTime > 0 ? Math.round(d.currentTime * 1000) : 0,
      iLastTime: secToMs(d.lastLapTime),
      iBestTime: bestMs,
      sessionTimeLeft: d.eventTimeRemaining,
      isInPit: d.pitMode === PIT_MODE.IN_PIT || d.pitMode === PIT_MODE.IN_GARAGE,
      isInPitLane:
        d.pitMode === PIT_MODE.DRIVING_INTO_PITS ||
        d.pitMode === PIT_MODE.DRIVING_OUT_OF_PITS ||
        d.pitMode === PIT_MODE.DRIVING_OUT_OF_GARAGE,
      numberOfLaps: d.lapsInEvent,
      pitRequested: d.pitSchedule === 1, // PIT_SCHEDULE_PLAYER_REQUESTED
      tyreCompound: d.tyreCompound,
      windSpeed: d.windSpeed,
      windDirection: 0,
      rainIntensity: rain,
      rainIntensityIn10min: -1, // no forecast in AMS2 shared memory
      rainIntensityIn30min: -1,
      trackGripStatus: -1,
      usedFuel: this.fuel.used,
      tc: d.tractionControlSetting >= 0 ? d.tractionControlSetting : null,
      tcCut: null,
      engineMap: null,
      abs: d.antiLockSetting >= 0 ? d.antiLockSetting : null,
      flashingLights: (d.carFlags & CAR_FLAG.HEADLIGHT) !== 0,
      iDeltaLapTime: delta === null ? 0 : Math.round(Math.abs(delta) * 1000),
      iEstimatedLapTime:
        delta === null || bestMs === INT_MAX ? INT_MAX : Math.round(bestMs + delta * 1000),
      isDeltaPositive: delta !== null && delta > 0,
      isValidLap: !d.lapInvalidated,
      fuelEstimatedLaps: this.fuel.estimatedLaps,
      clock: 0,
    };
  }

  // Broadcasting-shaped standings events (see accBroadcastClient.js).
  _emitRoster(d) {
    const classes = [];
    for (const p of d.participants) {
      if (p.className && !classes.includes(p.className)) classes.push(p.className);
    }
    const classIndex = (p) => Math.max(0, classes.indexOf(p.className));

    // Position within class, for cupPosition.
    const classPos = new Map();
    for (const cls of classes) {
      d.participants
        .filter((p) => p.className === cls)
        .sort((a, b) => a.racePosition - b.racePosition)
        .forEach((p, i) => classPos.set(p.index, i + 1));
    }

    this.emit('realtimeUpdate', {
      eventIndex: 0,
      sessionIndex: 0,
      sessionType: d.sessionState,
      phase: 0,
      sessionTime: 0,
      sessionEndTime: d.eventTimeRemaining,
      focusedCarIndex: d.viewedIndex,
      activeCameraSet: '',
      activeCamera: '',
      currentHudPage: '',
    });

    const roster = JSON.stringify(
      d.participants.map((p) => [p.index, p.name, p.carName, p.className]),
    );
    if (roster !== this.lastRoster) {
      this.lastRoster = roster;
      this.emit('entryList', { carIndices: d.participants.map((p) => p.index) });
      for (const p of d.participants) {
        const parts = p.name.split(/\s+/);
        this.emit('entryListCar', {
          carIndex: p.index,
          carModelType: 0,
          teamName: p.carName,
          raceNumber: null, // not in AMS2 shared memory
          cupCategory: classIndex(p),
          className: p.className,
          currentDriverIndex: 0,
          nationality: 0,
          drivers: [
            {
              firstName: p.name,
              lastName: '',
              shortName: parts.map((w) => w[0] ?? '').join('').slice(0, 3).toUpperCase(),
              category: 0,
              nationality: 0,
            },
          ],
        });
      }
    }

    for (const p of d.participants) {
      const isMe = p.index === d.viewedIndex;
      this.emit('realtimeCarUpdate', {
        carIndex: p.index,
        driverIndex: 0,
        driverCount: 1,
        gear: isMe ? d.gear : 0,
        worldPosX: 0,
        worldPosY: 0,
        yaw: 0,
        carLocation: 0,
        // The player's own speed comes from the main block (same as physics).
        kmh: Math.round((isMe ? d.speed : p.speed) * 3.6),
        position: p.racePosition,
        cupPosition: classPos.get(p.index) ?? p.racePosition,
        trackPosition: p.racePosition,
        splinePosition: d.trackLength > 0 ? p.lapDistance / d.trackLength : 0,
        laps: p.lapsCompleted,
        delta: 0,
      });
    }
  }
}
