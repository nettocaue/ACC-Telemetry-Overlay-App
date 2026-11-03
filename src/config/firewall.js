// Windows Firewall rule for the phone page.
//
// When Windows asks "allow this app?", the rule it creates is tied to the
// exe path. Squirrel installs every update in a new folder (app-1.11.0,
// app-1.11.1…), so after an update the phone silently times out again.
// A rule by port survives updates; creating it needs admin, so it runs
// elevated (one UAC prompt) through PowerShell.
import { execFile } from 'node:child_process';

export const FIREWALL_RULE_NAME = 'Interleigos Telemetry (celular)';

function run(file, args, timeout = 15000) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout }, (error, stdout, stderr) => {
      resolve({ code: error ? (error.code ?? 1) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

// { supported, allowed, publicNetwork }
export async function checkFirewall(port) {
  if (process.platform !== 'win32') return { supported: false, allowed: true, publicNetwork: false };
  const rule = await run('netsh', [
    'advfirewall',
    'firewall',
    'show',
    'rule',
    `name=${FIREWALL_RULE_NAME}`,
  ]);
  // netsh prints the rule's LocalPort line; make sure it's our port.
  const allowed = rule.code === 0 && new RegExp(`\\b${port}\\b`).test(rule.stdout);
  const profile = await run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    '(Get-NetConnectionProfile | Select-Object -ExpandProperty NetworkCategory) -join ","',
  ]);
  const categories = profile.stdout.trim().split(',').filter(Boolean);
  // Any active network marked Public: our rule (private/domain) won't apply there.
  const publicNetwork = categories.includes('Public');
  return { supported: true, allowed, publicNetwork };
}

// Shows the UAC prompt. Resolves { ok, cancelled }.
export async function allowFirewall(port) {
  if (process.platform !== 'win32') return { ok: true, cancelled: false };
  const p = Number(port);
  if (!Number.isInteger(p) || p < 1 || p > 65535) return { ok: false, cancelled: false };
  const netshArgs =
    `advfirewall firewall add rule name="${FIREWALL_RULE_NAME}" dir=in action=allow ` +
    `protocol=TCP localport=${p} profile=private,domain`;
  const command =
    `try { $p = Start-Process -FilePath netsh -Verb RunAs -Wait -PassThru -WindowStyle Hidden ` +
    `-ArgumentList '${netshArgs}'; exit $p.ExitCode } catch { exit 1223 }`;
  const result = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], 120000);
  return { ok: result.code === 0, cancelled: result.code === 1223 };
}
