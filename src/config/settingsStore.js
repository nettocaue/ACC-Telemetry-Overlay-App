import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const defaults = {
  widgets: {},
};

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');

export function loadSettings() {
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf8');
    const parsed = JSON.parse(raw);
    return { ...defaults, ...parsed, widgets: { ...defaults.widgets, ...parsed.widgets } };
  } catch {
    return { widgets: {} };
  }
}

export function saveSettings(settings) {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
}
