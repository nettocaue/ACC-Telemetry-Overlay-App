// Feeds a vJoy virtual joystick so games see the phone as a real wheel.
// vJoy (https://github.com/BrunnerInnovation/vJoy — the maintained fork for
// Windows 10/11) is a kernel driver the user installs once; we talk to it
// through its vJoyInterface.dll with koffi, same as the shared memory reader.
//
// API reference: vJoyInterface.h from the vJoy SDK. All exports are plain
// C (cdecl), BOOL is a 4-byte int, axis values run 0x1..0x8000.
import fs from 'node:fs';
import path from 'node:path';
import koffi from 'koffi';

export const AXIS = { X: 0x30, Y: 0x31, Z: 0x32 };
const AXIS_MIN = 0x1;
const AXIS_MAX = 0x8000;

// VjdStat enum
const VJD_STAT_OWN = 0;
const VJD_STAT_FREE = 1;
const VJD_STAT_BUSY = 2;
const VJD_STAT_MISS = 3;

const DLL_CANDIDATES = [
  process.env.VJOY_DLL,
  path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'vJoy', 'x64', 'vJoyInterface.dll'),
  'C:\\Program Files\\vJoy\\x64\\vJoyInterface.dll',
  'vJoyInterface.dll', // anywhere on PATH
].filter(Boolean);

let api = null;

// Loads the DLL once. Throws an Error whose message is shown to the user.
function loadApi() {
  if (api) return api;
  if (process.platform !== 'win32') {
    throw new Error('O controle pelo celular só funciona no Windows.');
  }
  // The DLL is only loaded here, so users who never turn the controller on
  // never touch vJoy at all.
  let lib = null;
  for (const candidate of DLL_CANDIDATES) {
    if (path.isAbsolute(candidate) && !fs.existsSync(candidate)) continue;
    try {
      lib = koffi.load(candidate);
      break;
    } catch {
      // try the next location
    }
  }
  if (!lib) {
    throw new Error(
      'vJoy não está instalado. Instale o vJoy e reinicie o computador.',
    );
  }
  api = {
    vJoyEnabled: lib.func('int32 vJoyEnabled()'),
    GetVJDStatus: lib.func('int32 GetVJDStatus(uint32 rID)'),
    AcquireVJD: lib.func('int32 AcquireVJD(uint32 rID)'),
    RelinquishVJD: lib.func('void RelinquishVJD(uint32 rID)'),
    ResetVJD: lib.func('int32 ResetVJD(uint32 rID)'),
    GetVJDAxisExist: lib.func('int32 GetVJDAxisExist(uint32 rID, uint32 Axis)'),
    GetVJDButtonNumber: lib.func('int32 GetVJDButtonNumber(uint32 rID)'),
    SetAxis: lib.func('int32 SetAxis(int32 Value, uint32 rID, uint32 Axis)'),
    SetBtn: lib.func('int32 SetBtn(int32 Value, uint32 rID, uint8 nBtn)'),
  };
  return api;
}

export class VJoyDevice {
  constructor(deviceId = 1, { apiOverride } = {}) {
    this.deviceId = deviceId;
    this.apiOverride = apiOverride; // for tests
    this.api = null;
    this.acquired = false;
    this.lastAxis = new Map();
  }

  // Grabs the virtual device. Throws an Error with a user-facing message.
  open() {
    if (this.acquired) return;
    const a = this.apiOverride ?? loadApi();
    if (!a.vJoyEnabled()) {
      throw new Error(
        'O driver do vJoy está desativado. Abra o "Configure vJoy" e ative-o.',
      );
    }
    const id = this.deviceId;
    const status = a.GetVJDStatus(id);
    if (status === VJD_STAT_MISS) {
      throw new Error(
        `O dispositivo vJoy ${id} não existe. Crie-o no "Configure vJoy".`,
      );
    }
    if (status === VJD_STAT_BUSY) {
      throw new Error(
        `O dispositivo vJoy ${id} está em uso por outro programa (feche o outro programa ou use outro dispositivo).`,
      );
    }
    const missing = Object.entries(AXIS)
      .filter(([, usage]) => !a.GetVJDAxisExist(id, usage))
      .map(([name]) => name);
    if (missing.length) {
      throw new Error(
        `Ative os eixos ${missing.join(', ')} no dispositivo vJoy ${id} (Configure vJoy).`,
      );
    }
    if (a.GetVJDButtonNumber(id) < 2) {
      throw new Error(
        `O dispositivo vJoy ${id} precisa de pelo menos 2 botões (Configure vJoy).`,
      );
    }
    if (status !== VJD_STAT_OWN && status !== VJD_STAT_FREE) {
      throw new Error(`Não foi possível acessar o vJoy (status ${status}).`);
    }
    if (status === VJD_STAT_FREE && !a.AcquireVJD(id)) {
      throw new Error(`Não foi possível assumir o dispositivo vJoy ${id}.`);
    }
    this.api = a;
    this.acquired = true;
    this.lastAxis.clear();
    a.ResetVJD(id);
  }

  close() {
    if (!this.acquired) return;
    try {
      this.api.ResetVJD(this.deviceId);
      this.api.RelinquishVJD(this.deviceId);
    } catch {
      // the driver may already be gone (uninstalled / disabled)
    }
    this.acquired = false;
  }

  // value: 0..1
  setAxis(usage, value) {
    if (!this.acquired) return;
    const v = Math.round(
      AXIS_MIN + Math.max(0, Math.min(1, value)) * (AXIS_MAX - AXIS_MIN),
    );
    if (this.lastAxis.get(usage) === v) return;
    this.lastAxis.set(usage, v);
    this.api.SetAxis(v, this.deviceId, usage);
  }

  // button: 1-based
  setButton(button, pressed) {
    if (!this.acquired) return;
    this.api.SetBtn(pressed ? 1 : 0, this.deviceId, button);
  }
}
