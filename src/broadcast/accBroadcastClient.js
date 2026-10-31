// Client for Assetto Corsa Competizione's official UDP Broadcasting Protocol.
// Protocol reference: Kunos Simulazioni's public "ACC Broadcasting SDK" spec
// (distributed with the game under Documentation/BroadcastingNetworkProtocol).
// This is an independent implementation of that public wire format — no
// game or third-party SDK code is included.
import dgram from 'node:dgram';
import { EventEmitter } from 'node:events';

const OUT = {
  REGISTER_COMMAND_APPLICATION: 1,
  UNREGISTER_COMMAND_APPLICATION: 9,
  REQUEST_ENTRY_LIST: 10,
  REQUEST_TRACK_DATA: 11,
  CHANGE_HUD_PAGE: 49,
  CHANGE_FOCUS: 50,
};

const WATCHDOG_INTERVAL_MS = 3000;
const WATCHDOG_TIMEOUT_MS = 6000;

const IN = {
  REGISTRATION_RESULT: 1,
  REALTIME_UPDATE: 2,
  REALTIME_CAR_UPDATE: 3,
  ENTRY_LIST: 4,
  ENTRY_LIST_CAR: 6,
  TRACK_DATA: 5,
  BROADCASTING_EVENT: 7,
};

class Writer {
  constructor() {
    this.chunks = [];
  }
  u8(v) {
    this.chunks.push(Buffer.from([v & 0xff]));
    return this;
  }
  i16(v) {
    const b = Buffer.alloc(2);
    b.writeInt16LE(v, 0);
    this.chunks.push(b);
    return this;
  }
  u32(v) {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(v, 0);
    this.chunks.push(b);
    return this;
  }
  f32(v) {
    const b = Buffer.alloc(4);
    b.writeFloatLE(v, 0);
    this.chunks.push(b);
    return this;
  }
  string(v) {
    const utf = Buffer.from(v ?? '', 'utf8');
    this.i16(utf.length);
    this.chunks.push(utf);
    return this;
  }
  bool(v) {
    return this.u8(v ? 1 : 0);
  }
  toBuffer() {
    return Buffer.concat(this.chunks);
  }
}

class Reader {
  constructor(buf) {
    this.buf = buf;
    this.offset = 0;
  }
  u8() {
    const v = this.buf.readUInt8(this.offset);
    this.offset += 1;
    return v;
  }
  i16() {
    const v = this.buf.readInt16LE(this.offset);
    this.offset += 2;
    return v;
  }
  u16() {
    const v = this.buf.readUInt16LE(this.offset);
    this.offset += 2;
    return v;
  }
  i32() {
    const v = this.buf.readInt32LE(this.offset);
    this.offset += 4;
    return v;
  }
  u32() {
    const v = this.buf.readUInt32LE(this.offset);
    this.offset += 4;
    return v;
  }
  f32() {
    const v = this.buf.readFloatLE(this.offset);
    this.offset += 4;
    return v;
  }
  bool() {
    return this.u8() !== 0;
  }
  string() {
    const len = this.u16();
    const v = this.buf.toString('utf8', this.offset, this.offset + len);
    this.offset += len;
    return v;
  }
  hasMore() {
    return this.offset < this.buf.length;
  }
}

export class AccBroadcastClient extends EventEmitter {
  constructor() {
    super();
    this.socket = null;
    this.connectionId = null;
    this.readOnly = true;
    this.host = null;
    this.port = null;
    this.connectOptions = null;
    this.lastMessageAt = null;
    this.watchdogTimer = null;
  }

  connect(options) {
    const {
      host = '127.0.0.1',
      port = 9000,
      displayName = 'Interleigos Telemetry',
      connectionPassword = '',
      commandPassword = '',
      updateIntervalMs = 100,
    } = options;
    this.host = host;
    this.port = port;
    this.connectOptions = {
      displayName,
      connectionPassword,
      commandPassword,
      updateIntervalMs,
    };
    this.socket = dgram.createSocket('udp4');

    this.socket.on('message', (msg) => {
      this.lastMessageAt = Date.now();
      this._handleMessage(msg);
    });
    this.socket.on('error', (err) => this.emit('error', err));

    this.socket.bind(() => this._register());

    // ACC can stop pushing updates to a registered client across session
    // transitions (practice -> qualy -> race, or a session restart) without
    // ever telling us — re-registering on the same socket recovers from that
    // instead of leaving the widgets frozen on the last value forever.
    this.watchdogTimer = setInterval(
      () => this._checkWatchdog(),
      WATCHDOG_INTERVAL_MS,
    );
  }

  _register() {
    const {
      displayName,
      connectionPassword,
      commandPassword,
      updateIntervalMs,
    } = this.connectOptions;
    this.lastMessageAt = Date.now();
    this._send(
      new Writer()
        .u8(OUT.REGISTER_COMMAND_APPLICATION)
        .u8(4) // protocol version
        .string(displayName)
        .string(connectionPassword)
        .u32(updateIntervalMs)
        .string(commandPassword)
        .toBuffer(),
    );
  }

  _checkWatchdog() {
    if (!this.socket || this.lastMessageAt === null) return;
    if (Date.now() - this.lastMessageAt > WATCHDOG_TIMEOUT_MS) {
      this.emit('reregistering');
      this.connectionId = null;
      this._register();
    }
  }

  disconnect() {
    if (this.connectionId !== null) {
      this._send(
        new Writer()
          .u8(OUT.UNREGISTER_COMMAND_APPLICATION)
          .u32(this.connectionId)
          .toBuffer(),
      );
    }
    clearInterval(this.watchdogTimer);
    this.watchdogTimer = null;
    this.socket?.close();
    this.socket = null;
    this.connectionId = null;
    this.connectOptions = null;
    this.lastMessageAt = null;
  }

  requestEntryList() {
    if (this.connectionId === null) return;
    this._send(
      new Writer().u8(OUT.REQUEST_ENTRY_LIST).u32(this.connectionId).toBuffer(),
    );
  }

  requestTrackData() {
    if (this.connectionId === null) return;
    this._send(
      new Writer().u8(OUT.REQUEST_TRACK_DATA).u32(this.connectionId).toBuffer(),
    );
  }

  _send(buffer) {
    this.socket?.send(buffer, this.port, this.host);
  }

  _handleMessage(msg) {
    try {
      this._parseMessage(msg);
    } catch (err) {
      // The broadcasting wire format for ENTRY_LIST_CAR/TRACK_DATA is reconstructed
      // from Kunos's public protocol notes rather than official source, so a parsing
      // mismatch should not take the whole connection down.
      this.emit('parseError', { message: err.message });
    }
  }

  _parseMessage(msg) {
    const r = new Reader(msg);
    const type = r.u8();

    switch (type) {
      case IN.REGISTRATION_RESULT: {
        this.connectionId = r.i32();
        const success = r.bool();
        this.readOnly = r.bool();
        const errMsg = r.string();
        if (success) {
          this.emit('connected', {
            connectionId: this.connectionId,
            readOnly: this.readOnly,
          });
          this.requestEntryList();
          this.requestTrackData();
        } else {
          this.emit('registrationFailed', errMsg);
        }
        break;
      }
      case IN.REALTIME_UPDATE: {
        this.emit('realtimeUpdate', {
          eventIndex: r.u16(),
          sessionIndex: r.u16(),
          sessionType: r.u8(),
          phase: r.u8(),
          sessionTime: r.f32(),
          sessionEndTime: r.f32(),
          focusedCarIndex: r.i32(),
          activeCameraSet: r.string(),
          activeCamera: r.string(),
          currentHudPage: r.string(),
        });
        break;
      }
      case IN.REALTIME_CAR_UPDATE: {
        this.emit('realtimeCarUpdate', {
          carIndex: r.u16(),
          driverIndex: r.u16(),
          driverCount: r.u8(),
          gear: r.u8() - 1, // wire 0 = reverse, 1 = neutral → -1 = R, 0 = N, 1+ = gear
          worldPosX: r.f32(),
          worldPosY: r.f32(),
          yaw: r.f32(),
          carLocation: r.u8(),
          kmh: r.u16(),
          position: r.u16(),
          cupPosition: r.u16(),
          trackPosition: r.u16(),
          splinePosition: r.f32(),
          laps: r.u16(),
          delta: r.i32(),
        });
        break;
      }
      case IN.ENTRY_LIST: {
        const count = r.u16();
        const carIndices = [];
        for (let i = 0; i < count; i++) carIndices.push(r.u16());
        this.emit('entryList', { carIndices });
        break;
      }
      case IN.BROADCASTING_EVENT: {
        this.emit('broadcastingEvent', {
          type: r.u8(),
          message: r.string(),
          timeMs: r.i32(),
          carIndex: r.i32(),
        });
        break;
      }
      case IN.ENTRY_LIST_CAR: {
        const carIndex = r.u16();
        const carModelType = r.u8();
        const teamName = r.string();
        const raceNumber = r.i32();
        const cupCategory = r.u8();
        const currentDriverIndex = r.u8();
        const nationality = r.u16();
        const driverCount = r.u8();
        const drivers = [];
        for (let i = 0; i < driverCount; i++) {
          drivers.push({
            firstName: r.string(),
            lastName: r.string(),
            shortName: r.string(),
            category: r.u8(),
            nationality: r.u16(),
          });
        }
        this.emit('entryListCar', {
          carIndex,
          carModelType,
          teamName,
          raceNumber,
          cupCategory,
          currentDriverIndex,
          nationality,
          drivers,
        });
        break;
      }
      case IN.TRACK_DATA: {
        const connectionId = r.i32();
        const trackName = r.string();
        const trackId = r.i32();
        const trackMeters = r.i32();

        const cameraSetCount = r.u8();
        const cameraSets = {};
        for (let i = 0; i < cameraSetCount; i++) {
          const setName = r.string();
          const cameraCount = r.u8();
          const cameras = [];
          for (let j = 0; j < cameraCount; j++) cameras.push(r.string());
          cameraSets[setName] = cameras;
        }

        const hudPageCount = r.u8();
        const hudPages = [];
        for (let i = 0; i < hudPageCount; i++) hudPages.push(r.string());

        this.emit('trackData', {
          connectionId,
          trackName,
          trackId,
          trackMeters,
          cameraSets,
          hudPages,
        });
        break;
      }
      default:
        this.emit('unhandledMessage', { type });
    }
  }
}
