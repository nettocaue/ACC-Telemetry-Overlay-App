// Turns phone input (tilt steering, pedal sliders, shift gestures) into vJoy
// axis/button state.
//
// Safety first: a car with the throttle stuck open is the failure mode that
// matters, so the pedals drop to zero the moment input stops arriving (Wi-Fi
// hiccup, phone locked, app closed) — see INPUT_TIMEOUT_MS.
import { EventEmitter } from 'node:events';
import { AXIS, EXTRA_AXIS } from './vJoy.js';

const INPUT_TIMEOUT_MS = 400; // no input for this long → pedals released
const OWNER_TIMEOUT_MS = 3000; // another phone may take over after this
const SHIFT_PULSE_MS = 90;
const BIND_DURATION_MS = 1600;
const WATCHDOG_MS = 50;

export const BUTTON = { SHIFT_UP: 1, SHIFT_DOWN: 2 };

// Shortcut buttons on the phone → vJoy button numbers. The user binds each
// one once in ACC's Controls screen. Held for as long as the finger is down
// (the starter, for one, has to be held until the engine catches).
export const SHORTCUT_BUTTONS = {
  tcUp: 3,
  tcDown: 4,
  absUp: 5,
  absDown: 6,
  pitLimiter: 7,
  ignition: 8,
  starter: 9,
  flash: 10,
  pitRequest: 11,
};
export const BUTTONS_NEEDED = Math.max(...Object.values(SHORTCUT_BUTTONS));

// The full on-screen controller (Controle tab). LB/RB double as the shift
// buttons so racing mappings keep working; the rest come after the
// shortcuts. Held while the finger is down, like a real pad.
export const PAD_BUTTONS = {
  rb: BUTTON.SHIFT_UP,
  lb: BUTTON.SHIFT_DOWN,
  a: 12,
  b: 13,
  x: 14,
  y: 15,
  select: 16,
  start: 17,
  up: 18,
  down: 19,
  left: 20,
  right: 21,
};
export const PAD_BUTTONS_NEEDED = Math.max(...Object.values(PAD_BUTTONS));
const ALL_BUTTONS = { ...SHORTCUT_BUTTONS, ...PAD_BUTTONS };
// Second stick + left stick vertical. Centre = 0.5.
const PAD_AXES = { ly: EXTRA_AXIS.RX, rx: EXTRA_AXIS.RY, ry: EXTRA_AXIS.RZ };

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
      buttonCount: this.device.buttonCount ?? 0,
      buttonsNeeded: BUTTONS_NEEDED,
      padButtonsNeeded: PAD_BUTTONS_NEEDED,
      padAxes: this.device.extraAxes ? this.device.extraAxes.size : 0,
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

  handleInput(clientId, { steer, gas, brake, ly, rx, ry }) {
    if (!this._canDrive(clientId) || this.binding) return;
    this.lastInputAt = Date.now();
    this.released = false;
    this.device.setAxis(AXIS.X, (clamp(steer, -1, 1) + 1) / 2);
    this.device.setAxis(AXIS.Y, clamp(gas, 0, 1));
    this.device.setAxis(AXIS.Z, clamp(brake, 0, 1));
    // Only the Controle tab sends these (-1..1, centre 0).
    for (const [key, value] of Object.entries({ ly, rx, ry })) {
      if (value !== undefined) {
        this.device.setAxis(PAD_AXES[key], (clamp(value, -1, 1) + 1) / 2);
      }
    }
  }

  handleShift(clientId, dir) {
    if (!this._canDrive(clientId) || this.binding) return;
    this.lastInputAt = Date.now();
    this._pulse(dir > 0 ? BUTTON.SHIFT_UP : BUTTON.SHIFT_DOWN);
  }

  handleButton(clientId, id, pressed) {
    const button = ALL_BUTTONS[id];
    if (!button || !this._canDrive(clientId) || this.binding) return;
    if (button > (this.device.buttonCount ?? 0)) return;
    this.lastInputAt = Date.now();
    if (pressed) this.released = false;
    this.device.setButton(button, pressed);
  }

  // Moves one control on its own so the game's "press/move the control"
  // binding screen picks the right axis — moving the phone would wiggle
  // steering and pedals together.
  handleBind(clientId, target) {
    if (!this._canDrive(clientId)) return;
    const pulses = {
      shiftUp: BUTTON.SHIFT_UP,
      shiftDown: BUTTON.SHIFT_DOWN,
      ...SHORTCUT_BUTTONS,
    };
    const valid = [
      'steer',
      'steerLeft',
      'steerRight',
      'gas',
      'brake',
      ...Object.keys(PAD_AXES),
      ...Object.keys(pulses),
    ];
    if (!valid.includes(target)) return;
    this.lastInputAt = Date.now();
    this._neutral();
    if (pulses[target]) return this._pulse(pulses[target], 250);
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
    for (const usage of Object.values(PAD_AXES)) this.device.setAxis(usage, 0.5);
    this.device.setButton(BUTTON.SHIFT_UP, false);
    this.device.setButton(BUTTON.SHIFT_DOWN, false);
    for (const button of new Set(Object.values(ALL_BUTTONS))) {
      if (button <= (this.device.buttonCount ?? 0)) {
        this.device.setButton(button, false);
      }
    }
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
      } else if (this.binding.target === 'steerLeft') {
        // One side only, for games that bind left and right separately
        // (AMS2, Project CARS): centre → full left → centre.
        this.device.setAxis(AXIS.X, 0.5 - 0.5 * wave);
      } else if (this.binding.target === 'steerRight') {
        this.device.setAxis(AXIS.X, 0.5 + 0.5 * wave);
      } else if (PAD_AXES[this.binding.target]) {
        // Stick axes: centre → one end → centre.
        this.device.setAxis(PAD_AXES[this.binding.target], 0.5 + 0.5 * wave);
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
