import { execSync, execFileSync } from 'child_process';
import { mkdirSync, existsSync } from 'fs';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8'));
const version = pkg.version;

console.log(`Building ACC Telemetry App v${version} installer…`);

console.log('\n[1/3] Packaging Electron app…');
execSync('npx electron-forge package', { stdio: 'inherit', cwd: __dirname });

console.log('\n[2/3] Preparing output directory…');
mkdirSync(join(__dirname, 'dist'), { recursive: true });

console.log('\n[3/3] Compiling NSIS installer…');
const NSIS_FALLBACK = 'C:\\Program Files (x86)\\NSIS\\makensis.exe';
const makensis = existsSync(NSIS_FALLBACK) ? NSIS_FALLBACK : 'makensis';
execFileSync(makensis, [`/DAPP_VERSION=${version}`, 'installer.nsi'], { stdio: 'inherit', cwd: __dirname });

console.log(`\nDone! dist\\ACC-Telemetry-App-${version}-Setup.exe`);
