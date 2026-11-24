// Automatic updates from GitHub Releases: every push to main publishes a new version
// (.github/workflows/release.yml); installed copies download it in the background and install it on quit,
// or right away when the person clicks «Reiniciar ahora» in the sidebar.
// What happened is written to updater.log in AdFlow's data folder.
import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import fs from 'node:fs';
import path from 'node:path';
import type { UpdateState } from '@shared/api';

const CHECK_EVERY_MS = 30 * 60_000;

let state: UpdateState = { readyVersion: null };

function log(text: string): void {
  const line = `${new Date().toISOString()} ${text}\n`;
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'updater.log'), line);
  } catch {
    /* logging must never break the app */
  }
}

export const updateState = (): UpdateState => state;

export function startAutoUpdates(onChange: (s: UpdateState) => void): void {
  // Development runs (npm run dev / start) have no installer to update.
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => log(`revisa actualizaciones (versión actual ${app.getVersion()})`));
  autoUpdater.on('update-not-available', () => log('sin actualizaciones'));
  autoUpdater.on('update-available', (info) => log(`descarga ${info.version}`));
  // Progress every 10 %, so a slow or stuck download shows in the log.
  let lastStep = -1;
  autoUpdater.on('download-progress', (p) => {
    const step = Math.floor(p.percent / 10);
    if (step === lastStep) return;
    lastStep = step;
    const mb = (n: number) => (n / 1_048_576).toFixed(0);
    log(`descargando: ${Math.floor(p.percent)} % (${mb(p.transferred)} de ${mb(p.total)} MB, ${(p.bytesPerSecond / 1_048_576).toFixed(1)} MB/s)`);
  });
  autoUpdater.on('update-downloaded', (info) => {
    log(`${info.version} lista; se instala al cerrar AdFlow`);
    state = { readyVersion: info.version };
    onChange(state);
  });
  autoUpdater.on('error', (err) => log(`error: ${err?.message ?? err}`));
  // Once a version is downloaded, later checks would only download it again.
  const check = () => {
    if (!state.readyVersion) autoUpdater.checkForUpdates().catch(() => undefined); // errors arrive via 'error'
  };
  check();
  setInterval(check, CHECK_EVERY_MS);
}

export function restartToUpdate(): void {
  if (!state.readyVersion) return;
  log(`reinicia para instalar ${state.readyVersion}`);
  // Silent install, then AdFlow opens again in the new version. Deferred so the IPC call answers first.
  setImmediate(() => autoUpdater.quitAndInstall(true, true));
}
