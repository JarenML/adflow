// Starts the built app. Clears ELECTRON_RUN_AS_NODE, which editors built on Electron (VS Code)
// set in their terminals and which would make Electron behave like plain Node.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electron = (await import('electron')).default;
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const p = spawn(electron, ['.'], { cwd: root, stdio: 'inherit', env });
p.on('exit', (c) => process.exit(c ?? 0));
