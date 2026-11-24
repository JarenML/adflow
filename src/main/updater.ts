// Automatic updates from GitHub Releases: every push to main publishes a new version
// (.github/workflows/release.yml); installed copies download it in the background and install it on quit.
// What happened is written to updater.log in AdFlow's data folder.
import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import fs from 'node:fs';
import path from 'node:path';

const CHECK_EVERY_MS = 30 * 60_000;

function log(text: string): void {
  const line = `${new Date().toISOString()} ${text}\n`;
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'updater.log'), line);
  } catch {
    /* logging must never break the app */
  }
}

export function startAutoUpdates(): void {
  // Development runs (npm run dev / start) have no installer to update.
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => log(`revisa actualizaciones (versión actual ${app.getVersion()})`));
  autoUpdater.on('update-not-available', () => log('sin actualizaciones'));
  autoUpdater.on('update-available', (info) => log(`descarga ${info.version}`));
  autoUpdater.on('update-downloaded', (info) => log(`${info.version} lista; se instala al cerrar AdFlow`));
  autoUpdater.on('error', (err) => log(`error: ${err?.message ?? err}`));
  const check = () => autoUpdater.checkForUpdatesAndNotify().catch(() => undefined); // errors arrive via 'error'
  void check();
  setInterval(check, CHECK_EVERY_MS);
}
