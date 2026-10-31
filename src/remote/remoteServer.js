// Serves the phone dash over the local network: an HTTPS server for the page
// itself plus a WebSocket that streams a compact telemetry snapshot ~30×/s.
//
// HTTPS (with a self-signed cert, see selfSignedCert.js) rather than plain
// HTTP because the phone-controller mode needs motion sensors, which Chrome
// only exposes to secure contexts — doing it now keeps the URL stable.
//
// Access is gated by a random token baked into the QR code / URL, so other
// devices on the same Wi-Fi can't just open the socket.
import crypto from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { acceptUpgrade } from './miniWebSocket.js';
import { generateSelfSignedCert } from './selfSignedCert.js';

const SEND_INTERVAL_MS = 33; // ~30Hz is plenty for a dash; physics is 60Hz
const KEEPALIVE_INTERVAL_MS = 5000;
const CLIENT_TIMEOUT_MS = 15000;
const LAP_HISTORY = 5;
const INT_MAX = 2147483647;
// ACC stops bumping packetId when paused or closed; after this long without
// a new physics packet the phone shows "waiting" instead of frozen values.
const STALE_AFTER_MS = 2000;

// Phone vibration: how often each effect may fire while it lasts.
const KERB_EVERY_MS = 100;
const OFFTRACK_EVERY_MS = 220;

const validLapMs = (ms) => (ms > 0 && ms < INT_MAX ? ms : null);

export function generateToken() {
  return crypto.randomBytes(8).toString('hex');
}

// IPv4 LAN addresses, private ranges first (what a phone on the same Wi-Fi
// can actually reach), skipping loopback and link-local.
export function lanAddresses() {
  const isPrivate = (ip) =>
    /^10\./.test(ip) ||
    /^192\.168\./.test(ip) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
  const ips = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal || a.address.startsWith('169.254.')) continue;
      ips.push({ ip: a.address, name, private: isPrivate(a.address) });
    }
  }
  // Virtual adapters (WSL, Hyper-V, VirtualBox, VPNs) are rarely what the
  // phone is on; push them after real Wi-Fi/Ethernet adapters.
  const isVirtual = (n) => /vethernet|wsl|hyper-v|virtualbox|vmware|vpn/i.test(n);
  ips.sort(
    (a, b) =>
      Number(b.private) - Number(a.private) ||
      Number(isVirtual(a.name)) - Number(isVirtual(b.name)),
  );
  return ips;
}

function loadOrCreateCert(certPath) {
  try {
    const saved = JSON.parse(fs.readFileSync(certPath, 'utf8'));
    if (saved.cert && saved.key) return saved;
  } catch {
    // first run, or the file is unreadable — make a new one
  }
  const generated = generateSelfSignedCert({
    ips: lanAddresses().map((a) => a.ip),
  });
  try {
    fs.mkdirSync(path.dirname(certPath), { recursive: true });
    fs.writeFileSync(certPath, JSON.stringify(generated));
  } catch {
    // Not fatal: we just regenerate (and the phone re-warns) next launch.
  }
  return generated;
}

export class RemoteServer extends EventEmitter {
  // assets: { html, js, css } — the phone page, as strings.
  constructor({ certPath, assets }) {
    super();
    this.certPath = certPath;
    this.assets = assets;
    this.server = null;
    this.port = null;
    this.token = null;
    this.clients = new Set();
    this.nextClientId = 1;
    // Phone-controller state pushed to every phone: { ready, error, ownerId }
    this.controllerState = { enabled: false, ready: false, error: null, ownerId: null };
    this.sendTimer = null;
    this.keepaliveTimer = null;
    this.error = null;

    this.physics = null;
    this.lastPhysicsAt = 0;
    this.haptics = { lastKerbAt: 0, lastOffTrackAt: 0, lastImpactCount: null };
    this.graphics = null;
    this.staticData = null;
    this.lapHistory = [];
    this.lastCompletedLaps = null;
  }

  get running() {
    return this.server !== null && this.error === null;
  }

  start({ port, token }) {
    if (this.server) this.stop();
    this.port = port;
    this.token = token;
    this.error = null;

    const { cert, key } = loadOrCreateCert(this.certPath);
    this.server = https.createServer({ cert, key }, (req, res) =>
      this._handleHttp(req, res),
    );
    this.server.on('upgrade', (req, socket) => this._handleUpgrade(req, socket));
    this.server.on('error', (err) => {
      this.error =
        err.code === 'EADDRINUSE'
          ? `A porta ${port} já está em uso por outro programa.`
          : err.message;
      this._emitStatus();
    });
    this.server.on('listening', () => this._emitStatus());
    this.server.listen(port, '0.0.0.0');

    this.keepaliveTimer = setInterval(() => this._keepalive(), KEEPALIVE_INTERVAL_MS);
  }

  stop() {
    clearInterval(this.sendTimer);
    clearInterval(this.keepaliveTimer);
    this.sendTimer = null;
    this.keepaliveTimer = null;
    for (const client of this.clients) client.close(1001);
    this.clients.clear();
    this.server?.close();
    this.server = null;
    this.error = null;
    this._emitStatus();
  }

  status() {
    return {
      running: this.running,
      error: this.error,
      port: this.port,
      clients: this.clients.size,
      addresses: lanAddresses().map(({ ip, name }) => ({
        ip,
        name,
        url: `https://${ip}:${this.port}/?t=${this.token}`,
      })),
    };
  }

  // --- Telemetry input (fed from main.js) ---------------------------------

  updatePhysics(physics) {
    this.physics = physics;
    this.lastPhysicsAt = Date.now();
    this._detectHaptics(physics);
  }

  updateStatic(staticData) {
    this.staticData = staticData;
  }

  updateGraphics(graphics) {
    const laps = graphics.completedLaps;
    // New session / restart: lap counter went backwards.
    if (this.lastCompletedLaps !== null && laps < this.lastCompletedLaps) {
      this.lapHistory = [];
    }
    if (this.lastCompletedLaps !== null && laps > this.lastCompletedLaps) {
      const lastMs = validLapMs(graphics.iLastTime);
      if (lastMs) {
        this.lapHistory.unshift({ lap: laps, ms: lastMs });
        this.lapHistory.length = Math.min(this.lapHistory.length, LAP_HISTORY);
      }
    }
    this.lastCompletedLaps = laps;
    this.graphics = graphics;
  }

  // Turns kerb / off-track / impact signals (see the game clients) into
  // short vibration commands for the phone that's driving.
  _detectHaptics(p) {
    if (this.clients.size === 0) return;
    const h = this.haptics;
    const now = Date.now();
    const kerb = p.kerb ?? 0;
    if (kerb > 0.08 && now - h.lastKerbAt >= KERB_EVERY_MS) {
      h.lastKerbAt = now;
      this._sendHaptic('kerb', Math.round(10 + kerb * 25));
    }
    if (p.offTrack && now - h.lastOffTrackAt >= OFFTRACK_EVERY_MS) {
      h.lastOffTrackAt = now;
      this._sendHaptic('offtrack', 70);
    }
    const count = p.impactCount ?? 0;
    if (h.lastImpactCount !== null && count > h.lastImpactCount) {
      this._sendHaptic('impact', Math.round(120 + (p.impactStrength ?? 0.5) * 330));
    }
    // Counts restart when the game (or session) changes: just follow along.
    h.lastImpactCount = count;
  }

  _sendHaptic(kind, ms) {
    const payload = JSON.stringify({ type: 'haptic', kind, ms });
    for (const client of this.clients) client.send(payload);
  }

  // --- Internals -----------------------------------------------------------

  _emitStatus() {
    this.emit('status', this.status());
  }

  _handleHttp(req, res) {
    const url = new URL(req.url, 'https://localhost');
    const routes = {
      '/': ['html', 'text/html; charset=utf-8'],
      '/index.html': ['html', 'text/html; charset=utf-8'],
      '/phone.js': ['js', 'text/javascript; charset=utf-8'],
      '/phone.css': ['css', 'text/css; charset=utf-8'],
    };
    const route = routes[url.pathname];
    if (req.method !== 'GET' || !route) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': route[1],
      // Always fetch the page fresh, so an app update reaches the phone.
      'Cache-Control': 'no-store',
    });
    res.end(this.assets[route[0]]);
  }

  _tokenMatches(candidate) {
    if (typeof candidate !== 'string' || !this.token) return false;
    const a = Buffer.from(candidate);
    const b = Buffer.from(this.token);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  _handleUpgrade(req, socket) {
    const url = new URL(req.url, 'https://localhost');
    if (url.pathname !== '/ws' || !this._tokenMatches(url.searchParams.get('t'))) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    const client = acceptUpgrade(req, socket);
    if (!client) return;

    client.id = this.nextClientId++;
    this.clients.add(client);
    client.on('close', () => {
      this.clients.delete(client);
      this.emit('clientGone', client.id);
      if (this.clients.size === 0) {
        clearInterval(this.sendTimer);
        this.sendTimer = null;
      }
      this._emitStatus();
    });
    client.on('message', (text) => this._handleClientMessage(client, text));

    client.send(JSON.stringify({ type: 'hello', version: 2 }));
    client.send(this._controllerMessage(client));
    if (!this.sendTimer) {
      this.sendTimer = setInterval(() => this._broadcast(), SEND_INTERVAL_MS);
    }
    this._emitStatus();
  }

  _handleClientMessage(client, text) {
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    switch (msg?.type) {
      case 'ping':
        client.send(JSON.stringify({ type: 'pong', t: msg.t }));
        break;
      case 'input':
        this.emit('input', client.id, {
          steer: Number(msg.steer),
          gas: Number(msg.gas),
          brake: Number(msg.brake),
        });
        break;
      case 'shift':
        this.emit('shift', client.id, Number(msg.dir));
        break;
      case 'button':
        this.emit('button', client.id, String(msg.id), Boolean(msg.pressed));
        break;
      case 'bind':
        this.emit('bind', client.id, String(msg.target));
        break;
      default:
        break;
    }
  }

  // Called by main.js whenever the phone controller's state changes.
  setControllerState(state) {
    this.controllerState = state;
    for (const client of this.clients) client.send(this._controllerMessage(client));
  }

  _controllerMessage(client) {
    const { enabled, ready, error, ownerId, buttonCount, buttonsNeeded } =
      this.controllerState;
    return JSON.stringify({
      type: 'controller',
      enabled,
      ready,
      error,
      buttonCount: buttonCount ?? 0,
      buttonsNeeded: buttonsNeeded ?? 0,
      // Another phone is currently driving.
      busy: ownerId !== null && ownerId !== client.id,
    });
  }

  _keepalive() {
    const now = Date.now();
    for (const client of this.clients) {
      if (now - client.lastSeenAt > CLIENT_TIMEOUT_MS) client.terminate();
      else client.ping();
    }
  }

  _snapshot() {
    const p = this.physics;
    const g = this.graphics;
    const s = this.staticData;
    if (!p && !g) return { type: 'telemetry', live: false };

    // Shared memory gear: 0 = R, 1 = N, 2 = 1st… → -1 = R, 0 = N, 1+ = gear
    const gear = p ? p.gear - 1 : 0;
    return {
      type: 'telemetry',
      live: Boolean(p) && Date.now() - this.lastPhysicsAt < STALE_AFTER_MS,
      car: s?.carModel ?? '',
      track: s?.track ?? '',
      gear,
      speed: p ? Math.round(p.speedKmh) : 0,
      rpm: p?.rpm ?? 0,
      maxRpm: s?.maxRpm || 9000,
      gas: p?.gas ?? 0,
      brake: p?.brake ?? 0,
      clutch: p?.clutch ?? 0,
      ffb: p?.finalFF ?? 0,
      pitLimiter: Boolean(p?.pitLimiterOn),
      pitRequested: Boolean(g?.pitRequested),
      ignition: Boolean(p?.ignitionOn),
      engineRunning: Boolean(p?.isEngineRunning),
      tc: g?.tc ?? null,
      abs: g?.abs ?? null,
      flashing: Boolean(g?.flashingLights),
      tcActive: Boolean(p?.tcInAction),
      absActive: Boolean(p?.absInAction),
      fuel: p?.fuel ?? 0,
      fuelLaps: g?.fuelEstimatedLaps ?? 0,
      tyreTemp: p?.tyreCoreTemp ?? [0, 0, 0, 0],
      tyrePsi: p?.wheelPressure ?? [0, 0, 0, 0],
      compound: g?.tyreCompound ?? '',
      position: g?.position ?? 0,
      laps: g?.completedLaps ?? 0,
      totalLaps: g?.numberOfLaps ?? 0,
      currentLap: validLapMs(g?.iCurrentTime),
      lastLap: validLapMs(g?.iLastTime),
      bestLap: validLapMs(g?.iBestTime),
      // iDeltaLapTime is unsigned in practice; isDeltaPositive gives the sign.
      delta:
        g && validLapMs(g.iBestTime) && g.iCurrentTime > 0
          ? Math.abs(g.iDeltaLapTime) * (g.isDeltaPositive ? 1 : -1)
          : null,
      validLap: g?.isValidLap ?? true,
      inPit: Boolean(g?.isInPit || g?.isInPitLane),
      lapHistory: this.lapHistory,
      airTemp: p?.airTemp ?? 0,
      roadTemp: p?.roadTemp ?? 0,
      rain: g
        ? [g.rainIntensity, g.rainIntensityIn10min, g.rainIntensityIn30min]
        : [0, 0, 0],
    };
  }

  _broadcast() {
    if (this.clients.size === 0) return;
    const payload = JSON.stringify(this._snapshot());
    for (const client of this.clients) client.send(payload);
  }
}
