// Turns phone input (tilt steering, pedal sliders, shift gestures) into vJoy
// axis/button state.
//
// Safety first: a car with the throttle stuck open is the failure mode that
// matters, so the pedals drop to zero the moment input stops arriving (Wi-Fi
// hiccup, phone locked, app closed) — see INPUT_TIMEOUT_MS.
import { EventEmitter } from 'node:events';
import { AXIS } from './vJoy.js';

const INPUT_TIMEOUT_MS = 400; // no input for this long → pedals released
const OWNER_TIMEOUT_MS = 3000; // another phone may take over after this
const SHIFT_PULSE_MS = 90;
const BIND_DURATION_MS = 1600;
const WATCHDOG_MS = 50;

export const BUTTON = { SHIFT_UP: 1, SHIFT_DOWN: 2 };

const clamp = (v, min, max) =>
  Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : 0;

export class PhoneController extends EventEmitter {
  constructor({ device }) {
    super();
    this.device = device;
    this.enabled = false;
    this.error = null;
    this.ownerId = null;
    this.lastInputAt = 0;
    this.released = true;
    this.binding = null; // { target, startedAt }
    this.watchdog = null;
    this.timers = new Set();
  }

  status() {
    return {
      enabled: this.enabled,
      ready: this.enabled && this.error === null,
      error: this.error,
      ownerId: this.ownerId,
    };
  }

  enable() {
    this.enabled = true;
    try {
      this.device.open();
      this.error = null;
      this._neutral();
    } catch (err) {
      this.error = err.message;
    }
    clearInterval(this.watchdog);
    this.watchdog = setInterval(() => this._tick(), WATCHDOG_MS);
    this._emitStatus();
  }

  disable() {
    this.enabled = false;
    clearInterval(this.watchdog);
    this.watchdog = null;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.binding = null;
    if (this.error === null) this._neutral();
    this.device.close();
    this.error = null;
    this.ownerId = null;
    this._emitStatus();
  }

  // --- Input from phones ---------------------------------------------------

  handleInput(clientId, { steer, gas, brake }) {
    if (!this._canDrive(clientId) || this.binding) return;
    this.lastInputAt = Date.now();
    this.released = false;
    this.device.setAxis(AXIS.X, (clamp(steer, -1, 1) + 1) / 2);
    this.device.setAxis(AXIS.Y, clamp(gas, 0, 1));
    this.device.setAxis(AXIS.Z, clamp(brake, 0, 1));
  }

  handleShift(clientId, dir) {
    if (!this._canDrive(clientId) || this.binding) return;
    this.lastInputAt = Date.now();
    this._pulse(dir > 0 ? BUTTON.SHIFT_UP : BUTTON.SHIFT_DOWN);
  }

  // Moves one control on its own so the game's "press/move the control"
  // binding screen picks the right axis — moving the phone would wiggle
  // steering and pedals together.
  handleBind(clientId, target) {
    if (!this._canDrive(clientId)) return;
    const valid = ['steer', 'gas', 'brake', 'shiftUp', 'shiftDown'];
    if (!valid.includes(target)) return;
    this.lastInputAt = Date.now();
    this._neutral();
    if (target === 'shiftUp') return this._pulse(BUTTON.SHIFT_UP, 250);
    if (target === 'shiftDown') return this._pulse(BUTTON.SHIFT_DOWN, 250);
    this.binding = { target, startedAt: Date.now() };
    this._emitStatus();
  }

  clientGone(clientId) {
    if (clientId !== this.ownerId) return;
    this.ownerId = null;
    this.binding = null;
    this._neutral();
    this._emitStatus();
  }

  // --- Internals -------------------------------------------------------------

  _canDrive(clientId) {
    if (!this.enabled || this.error) return false;
    const now = Date.now();
    if (
      this.ownerId === null ||
      (this.ownerId !== clientId && now - this.lastInputAt > OWNER_TIMEOUT_MS)
    ) {
      if (this.ownerId !== clientId) {
        this.ownerId = clientId;
        this._emitStatus();
      }
    }
    return this.ownerId === clientId;
  }

  _pulse(button, ms = SHIFT_PULSE_MS) {
    this.device.setButton(button, true);
    const t = setTimeout(() => {
      this.timers.delete(t);
      this.device.setButton(button, false);
    }, ms);
    this.timers.add(t);
  }

  _neutral() {
    this.device.setAxis(AXIS.X, 0.5);
    this.device.setAxis(AXIS.Y, 0);
    this.device.setAxis(AXIS.Z, 0);
    this.device.setButton(BUTTON.SHIFT_UP, false);
    this.device.setButton(BUTTON.SHIFT_DOWN, false);
    this.released = true;
  }

  _tick() {
    if (!this.enabled || this.error) return;
    const now = Date.now();

    if (this.binding) {
      const t = (now - this.binding.startedAt) / BIND_DURATION_MS;
      if (t >= 1) {
        this.binding = null;
        this._neutral();
        this._emitStatus();
        return;
      }
      const wave = Math.sin(t * Math.PI); // 0 → 1 → 0
      if (this.binding.target === 'steer') {
        // centre → full right → full left → centre
        this.device.setAxis(AXIS.X, 0.5 + 0.5 * Math.sin(t * 2 * Math.PI));
      } else {
        this.device.setAxis(this.binding.target === 'gas' ? AXIS.Y : AXIS.Z, wave);
      }
      return;
    }

    if (!this.released && now - this.lastInputAt > INPUT_TIMEOUT_MS) {
      this._neutral();
    }
  }

  _emitStatus() {
    this.emit('status', this.status());
  }
}
