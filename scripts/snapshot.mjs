// Captures the app window to a PNG: node scripts/snapshot.mjs <out.png> [route] [delayMs]
// Uses the sandbox data folder so real settings are never touched.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [out, route = '', delay = '3000'] = process.argv.slice(2);
const electron = (await import('electron')).default;
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const p = spawn(electron, ['.'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...env, ADFLOW_DATA_DIR: path.join(root, '.sandbox/data'), ADFLOW_SNAPSHOT: path.resolve(out), ADFLOW_ROUTE: route, ADFLOW_SNAPSHOT_DELAY: delay },
});
p.on('exit', (c) => process.exit(c ?? 0));
