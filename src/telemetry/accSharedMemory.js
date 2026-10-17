// Reads ACC's Shared Memory API (Local\acpmf_physics / acpmf_static), the
// official Kunos interface for fuel, tyre, damage and brake telemetry that
// the Broadcasting protocol does not expose.
//
// Field layout verified against two independent sources:
//  - Kunos's own "ACC Shared Memory v1.8.12" PDF (field names/order/meaning)
//  - rrennoir/PyAccSharedMemory (MIT) for exact byte offsets/padding, since
//    the PDF alone doesn't specify C struct padding around the wchar_t fields.
// No code from either source is copied; this is an independent Node/koffi
// implementation of the same publicly documented memory layout.
import koffi from 'koffi';
import { EventEmitter } from 'node:events';

const FILE_MAP_READ = 0x0004;
const NUL_CHAR = String.fromCharCode(0);

// Win32 BOOL is a 4-byte int, not a 1-byte C/C++ bool — using koffi's 'bool'
// here misaligns the native call and crashes the process (N-API fatal error).
const kernel32 = koffi.load('kernel32.dll');
const OpenFileMappingW = kernel32.func(
  '__stdcall',
  'OpenFileMappingW',
  'void *',
  ['uint32', 'int32', 'wchar_t *'],
);
const MapViewOfFile = kernel32.func('__stdcall', 'MapViewOfFile', 'void *', [
  'void *',
  'uint32',
  'uint32',
  'uint32',
  'size_t',
]);
const UnmapViewOfFile = kernel32.func('__stdcall', 'UnmapViewOfFile', 'int32', [
  'void *',
]);
const CloseHandle = kernel32.func('__stdcall', 'CloseHandle', 'int32', [
  'void *',
]);

class Reader {
  constructor(buf) {
    this.buf = buf;
    this.o = 0;
  }
  i32() {
    const v = this.buf.readInt32LE(this.o);
    this.o += 4;
    return v;
  }
  f32() {
    const v = this.buf.readFloatLE(this.o);
    this.o += 4;
    return v;
  }
  bool() {
    return this.i32() !== 0;
  }
  arrF(n) {
    const a = [];
    for (let i = 0; i < n; i++) a.push(this.f32());
    return a;
  }
  arr2F(n, m) {
    const a = [];
    for (let i = 0; i < n; i++) a.push(this.arrF(m));
    return a;
  }
  wstring(charCount, paddingBytes = 0) {
    const byteLen = charCount * 2;
    const raw = this.buf.toString('utf16le', this.o, this.o + byteLen);
    this.o += byteLen + paddingBytes;
    const nulIndex = raw.indexOf(NUL_CHAR);
    return nulIndex === -1 ? raw : raw.slice(0, nulIndex);
  }
}

function parsePhysics(buf) {
  const r = new Reader(buf);
  const packetId = r.i32();
  const gas = r.f32();
  const brake = r.f32();
  const fuel = r.f32();
  const gear = r.i32();
  const rpm = r.i32();
  const steerAngle = r.f32();
  const speedKmh = r.f32();
  r.arrF(3); // velocity
  r.arrF(3); // accG
  r.arrF(4); // wheelSlip
  r.arrF(4); // wheelLoad
  const wheelPressure = r.arrF(4); // [FL, FR, RL, RR]
  r.arrF(4); // wheelAngularSpeed
  const tyreWear = r.arrF(4);
  r.arrF(4); // tyreDirtyLevel
  const tyreCoreTempEarly = r.arrF(4);
  r.arrF(4); // camberRAD
  r.arrF(4); // suspensionTravel
  r.i32(); // drs
  r.f32(); // tc
  r.f32(); // heading
  r.f32(); // pitch
  r.f32(); // roll
  r.f32(); // cgHeight
  const carDamageArr = r.arrF(5); // front, rear, left, right, centre
  r.i32(); // numberOfTyresOut
  r.i32(); // pitLimiterOn
  r.f32(); // abs
  r.f32(); // kersCharge (unused)
  r.f32(); // kersInput (unused)
  r.i32(); // autoshifterOn
  r.arrF(2); // rideHeight
  r.f32(); // turboBoost
  r.f32(); // ballast
  r.f32(); // airDensity
  const airTemp = r.f32();
  const roadTemp = r.f32();
  r.arrF(3); // localAngularVel
  r.f32(); // finalFF
  r.f32(); // performanceMeter
  r.i32(); // engineBrake
  r.i32(); // ersRecoveryLevel
  r.i32(); // ersPowerLevel
  r.i32(); // ersHeatCharging
  r.i32(); // ersIsCharging
  r.f32(); // kersCurrentKJ
  r.i32(); // drsAvailable
  r.i32(); // drsEnabled
  const brakeTemp = r.arrF(4);
  const clutch = r.f32();
  r.arrF(4); // tyreTempI (not shown in ACC)
  r.arrF(4); // tyreTempM (not shown in ACC)
  r.arrF(4); // tyreTempO (not shown in ACC)
  r.i32(); // isAIControlled
  r.arr2F(4, 3); // tyreContactPoint
  r.arr2F(4, 3); // tyreContactNormal
  r.arr2F(4, 3); // tyreContactHeading
  r.f32(); // brakeBias
  r.arrF(3); // localVelocity
  r.i32(); // P2PActivation
  r.i32(); // P2PStatus
  r.i32(); // currentMaxRpm
  r.arrF(4); // mz
  r.arrF(4); // fz
  r.arrF(4); // my
  r.arrF(4); // slipRatio
  r.arrF(4); // slipAngle
  r.i32(); // tcinAction
  r.i32(); // absInAction
  r.arrF(4); // suspensionDamage
  const tyreCoreTemp = r.arrF(4); // "Tyres core temperatures" per Kunos docs
  const waterTemp = r.f32();
  r.arrF(4); // brakePressure
  r.i32(); // frontBrakeCompound
  r.i32(); // rearBrakeCompound
  const padLife = r.arrF(4);
  const discLife = r.arrF(4);
  r.i32(); // ignitionOn
  r.i32(); // starterEngineOn
  const isEngineRunning = r.bool();

  return {
    packetId,
    gas,
    brake,
    clutch,
    steerAngle,
    fuel,
    gear,
    rpm,
    speedKmh,
    wheelPressure,
    tyreWear,
    tyreCoreTempEarly,
    tyreCoreTemp,
    carDamage: {
      front: carDamageArr[0],
      rear: carDamageArr[1],
      left: carDamageArr[2],
      right: carDamageArr[3],
      centre: carDamageArr[4],
    },
    brakeTemp,
    padLife,
    discLife,
    airTemp,
    roadTemp,
    waterTemp,
    isEngineRunning,
  };
}

function parseStatic(buf) {
  const r = new Reader(buf);
  r.wstring(15); // smVersion
  r.wstring(15); // acVersion
  r.i32(); // numberOfSessions
  const numCars = r.i32();
  const carModel = r.wstring(33);
  const track = r.wstring(33);
  r.wstring(33); // playerName
  r.wstring(33); // playerSurname
  r.wstring(33, 2); // playerNick
  r.i32(); // sectorCount
  r.f32(); // maxTorque
  r.f32(); // maxPower
  const maxRpm = r.i32();
  const maxFuel = r.f32();

  return { numCars, carModel, track, maxRpm, maxFuel };
}

function parseGraphics(buf) {
  const r = new Reader(buf);
  const packetId = r.i32();
  r.i32(); // status
  r.i32(); // session
  r.wstring(15); // currentTime string
  r.wstring(15); // lastTime string
  r.wstring(15); // bestTime string
  r.wstring(15); // split
  const completedLaps = r.i32();
  const position = r.i32();
  // ACC stores these as seconds despite the "ms" name in the Kunos PDF —
  // multiply by 1000 so the rest of the app works in milliseconds throughout.
  const iCurrentTime = r.f32() * 1000;
  const iLastTime = r.f32() * 1000;
  const iBestTime = r.f32() * 1000;
  const sessionTimeLeft = r.f32();
  r.f32(); // distanceTraveled
  const isInPit = r.bool();
  r.i32(); // currentSectorIndex
  r.f32(); // lastSectorTime
  const numberOfLaps = r.i32();
  const tyreCompound = r.wstring(33, 2); // +2 padding to 4-byte boundary
  r.f32(); // replayTimeMultiplier
  r.f32(); // normalizedCarPosition
  r.i32(); // activeCars
  r.arr2F(60, 3); // carCoordinates[60][3] = 720 bytes
  for (let i = 0; i < 60; i++) r.i32(); // carID[60] = 240 bytes
  r.i32(); // playerCarID
  r.f32(); // penaltyTime
  r.i32(); // flag
  r.i32(); // penalty
  r.i32(); // idealLineOn
  const isInPitLane = r.bool();
  r.f32(); // surfaceGrip
  r.i32(); // mandatoryPitDone
  const windSpeed = r.f32();
  const windDirection = r.f32();
  r.i32(); // isSetupMenuVisible
  r.i32(); // mainDisplayIndex
  r.i32(); // mirrorDisplayIndex
  const rainIntensity = r.f32();
  const rainIntensityIn10min = r.f32();
  const rainIntensityIn30min = r.f32();
  r.i32(); // currentTyreSet
  r.f32(); // mfdTyreSet
  r.f32(); // mfdFuelToAdd
  r.arrF(4); // mfdTyrePressure[4]
  const trackGripStatus = r.i32();
  r.i32(); // rainLights
  r.i32(); // flashingLights
  r.i32(); // lightsStage
  r.f32(); // exhaustTemperature
  r.i32(); // wiperLV
  r.i32(); // driverStintTotalTimeLeft
  r.i32(); // driverStintTimeLeft
  r.i32(); // rainTyres
  r.i32(); // sessionIndex
  const usedFuel = r.f32();
  r.wstring(15, 2); // deltaLapTime + padding
  r.f32(); // iDeltaLapTime
  r.wstring(15, 2); // estimatedLapTime + padding
  const iEstimatedLapTime = r.f32() * 1000;
  const isDeltaPositive = r.bool();
  r.f32(); // iSplit
  const isValidLap = r.bool();
  const fuelEstimatedLaps = r.f32();
  r.wstring(33, 2); // trackStatus + padding
  r.f32(); // missingMandatoryPits
  const clock = r.f32();

  return {
    packetId,
    completedLaps,
    position,
    iCurrentTime,
    iLastTime,
    iBestTime,
    sessionTimeLeft,
    isInPit,
    isInPitLane,
    numberOfLaps,
    tyreCompound,
    windSpeed,
    windDirection,
    rainIntensity,
    rainIntensityIn10min,
    rainIntensityIn30min,
    trackGripStatus,
    usedFuel,
    iEstimatedLapTime,
    isDeltaPositive,
    isValidLap,
    fuelEstimatedLaps,
    clock,
  };
}

class SharedSection {
  constructor(name, size) {
    this.name = name;
    this.size = size;
    this.handle = null;
    this.view = null;
  }

  tryOpen() {
    if (this.view) return true;
    const handle = OpenFileMappingW(FILE_MAP_READ, 0, this.name);
    if (!handle) return false;
    // Pass 0 to map the entire file — requesting an explicit size larger than
    // what ACC created causes MapViewOfFile to return NULL on Windows, which
    // was silently preventing the graphics section from ever opening.
    const view = MapViewOfFile(handle, FILE_MAP_READ, 0, 0, 0);
    if (!view) {
      CloseHandle(handle);
      return false;
    }
    this.handle = handle;
    this.view = view;
    return true;
  }

  // koffi.view() creates an external ArrayBuffer, which Electron's V8 build
  // forbids (crashes the process). koffi.decode() copies bytes instead, so
  // it's the Electron-safe way to read raw memory through koffi.
  read() {
    const bytes = koffi.decode(this.view, 'uint8_t', this.size);
    return Buffer.from(bytes);
  }

  close() {
    if (this.view) UnmapViewOfFile(this.view);
    if (this.handle) CloseHandle(this.handle);
    this.view = null;
    this.handle = null;
  }
}

export class AccSharedMemoryClient extends EventEmitter {
  constructor() {
    super();
    this.physics = new SharedSection('Local\\acpmf_physics', 800);
    this.staticSection = new SharedSection('Local\\acpmf_static', 784);
    this.graphicsSection = new SharedSection('Local\\acpmf_graphics', 1516);
    this.lastGraphicsPacketId = null;
    this.timer = null;
    this.lastPacketId = null;
    this.lastStaticSnapshot = null;
  }

  start(intervalMs = 200) {
    if (this.timer) return;
    this.timer = setInterval(() => this._tick(), intervalMs);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.physics.close();
    this.staticSection.close();
    this.graphicsSection.close();
    this.lastGraphicsPacketId = null;
    this.lastPacketId = null;
  }

  _tick() {
    const physicsReady = this.physics.tryOpen();
    const staticReady = this.staticSection.tryOpen();
    if (!physicsReady || !staticReady) return;

    try {
      const physics = parsePhysics(this.physics.read());
      if (physics.packetId !== this.lastPacketId) {
        this.lastPacketId = physics.packetId;
        this.emit('physics', physics);
      }
      // Track name, max fuel/rpm etc. only change between sessions — avoid
      // re-sending the same snapshot to every consumer on every tick.
      const staticData = parseStatic(this.staticSection.read());
      const staticSnapshot = JSON.stringify(staticData);
      if (staticSnapshot !== this.lastStaticSnapshot) {
        this.lastStaticSnapshot = staticSnapshot;
        this.emit('static', staticData);
      }
      const graphicsReady = this.graphicsSection.tryOpen();
      if (graphicsReady) {
        const graphics = parseGraphics(this.graphicsSection.read());
        if (graphics.packetId !== this.lastGraphicsPacketId) {
          this.lastGraphicsPacketId = graphics.packetId;
          this.emit('graphics', graphics);
        }
      }
    } catch (err) {
      this.emit('error', err);
    }
  }
}
