// Makes the app self-configuring: ACC's Broadcasting API requires a
// Documents/Assetto Corsa Competizione/Config/broadcasting.json file with a
// port + password that our own connect() call must match. Rather than
// asking the user to create and pair that file by hand, we write it
// ourselves the first time (if it isn't already there) and always read
// back whatever is actually on disk, so a user who customized it keeps
// their own settings.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_PORT = 9000;
const DEFAULT_PASSWORD = 'acc-telemetry-app';

function broadcastingConfigPath() {
  return path.join(
    os.homedir(),
    'Documents',
    'Assetto Corsa Competizione',
    'Config',
    'broadcasting.json',
  );
}

export function ensureBroadcastingConfig() {
  const configPath = broadcastingConfigPath();

  try {
    const existing = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return {
      port: existing.updListenerPort ?? DEFAULT_PORT,
      connectionPassword: existing.connectionPassword ?? '',
      commandPassword: existing.commandPassword ?? '',
    };
  } catch {
    // Missing, unreadable, or not valid JSON yet (e.g. ACC has never run on
    // this machine) — write sensible defaults.
  }

  const defaults = {
    updListenerPort: DEFAULT_PORT,
    connectionPassword: DEFAULT_PASSWORD,
    commandPassword: '',
  };

  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(defaults, null, '\t'));
  } catch {
    // If ACC's Documents folder structure can't be created yet (e.g. ACC
    // has literally never been launched), fall back to these defaults for
    // this session; the user just needs to run ACC once and restart us.
  }

  return {
    port: defaults.updListenerPort,
    connectionPassword: defaults.connectionPassword,
    commandPassword: defaults.commandPassword,
  };
}
