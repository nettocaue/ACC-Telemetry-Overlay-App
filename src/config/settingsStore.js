import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_PROFILE = 'Default';

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');

export function loadSettings() {
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf8');
    const parsed = JSON.parse(raw);
    // Migrate from flat { widgets: {} } to profile-based schema
    if (parsed.widgets && !parsed.profiles) {
      return {
        activeProfile: DEFAULT_PROFILE,
        profiles: { [DEFAULT_PROFILE]: { widgets: parsed.widgets } },
      };
    }
    return {
      activeProfile: parsed.activeProfile ?? DEFAULT_PROFILE,
      profiles: { [DEFAULT_PROFILE]: { widgets: {} }, ...parsed.profiles },
    };
  } catch {
    return {
      activeProfile: DEFAULT_PROFILE,
      profiles: { [DEFAULT_PROFILE]: { widgets: {} } },
    };
  }
}

export function saveSettings(settings) {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
}
