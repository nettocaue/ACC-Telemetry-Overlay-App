// "Gravar diagnóstico": samples what the app is reading from the game for a
// few seconds and saves it (plus one raw copy of the shared memory) to a
// JSON file the user can send over, to check numbers against the source.
import fs from 'node:fs';
import path from 'node:path';
import { shell } from 'electron';

const DURATION_MS = 5000;
const INTERVAL_MS = 250;

const toBase64 = (buf) => (buf ? Buffer.from(buf).toString('base64') : null);

const snapshot = (client) =>
  client.lastParsed ? structuredClone(client.lastParsed) : null;

export async function recordDiagnostics({ app, activeGame, accClient, ams2Client }) {
  if (!activeGame) {
    return {
      ok: false,
      message: 'Nenhum jogo detectado. Entre na pista (ACC ou AMS2) e tente de novo.',
    };
  }
  const client = activeGame === 'ams2' ? ams2Client : accClient;
  const samples = [];
  const started = Date.now();
  await new Promise((resolve) => {
    const timer = setInterval(() => {
      samples.push({ t: Date.now() - started, data: snapshot(client) });
      if (Date.now() - started >= DURATION_MS) {
        clearInterval(timer);
        resolve();
      }
    }, INTERVAL_MS);
  });

  const raw =
    activeGame === 'ams2'
      ? { pcars2: toBase64(ams2Client.lastRaw) }
      : {
          physics: toBase64(accClient.lastRaw?.physics),
          graphics: toBase64(accClient.lastRaw?.graphics),
          static: toBase64(accClient.lastRaw?.static),
        };

  const dir = path.join(app.getPath('documents'), 'ACC Telemetry App', 'diagnostico');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `diagnostico-${activeGame}-${stamp}.json`);
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        app: app.getVersion(),
        game: activeGame,
        recordedAt: new Date().toISOString(),
        samples,
        raw,
      },
      null,
      1,
    ),
  );
  shell.showItemInFolder(file);
  return { ok: true, message: `Diagnóstico salvo em ${file}`, file };
}
