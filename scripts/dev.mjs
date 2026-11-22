// Development: Vite dev server for the UI + esbuild watch for main/preload + Electron.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const server = await createServer({ configFile: path.join(root, 'vite.config.ts') });
await server.listen();
const url = `http://localhost:${server.config.server.port}`;

const builder = spawn(process.execPath, [path.join(root, 'scripts/build-main.mjs'), '--watch'], {
  stdio: 'inherit',
});

// Give esbuild a moment for the first build before starting Electron.
await new Promise((r) => setTimeout(r, 1500));

const electronBin = (await import('electron')).default;
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = spawn(electronBin, ['.'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...env, ADFLOW_DEV_URL: url },
});

app.on('exit', async (code) => {
  builder.kill();
  await server.close();
  process.exit(code ?? 0);
});
