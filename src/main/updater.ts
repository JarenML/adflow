// Automatic updates from GitHub Releases: every push to main publishes a new version
// (.github/workflows/release.yml); installed copies download it in the background and install it on quit,
// or right away when the person clicks «Reiniciar ahora» in the sidebar or in Ajustes → Acerca de.
// What happened is written to updater.log in AdFlow's data folder.
import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import fs from 'node:fs';
import path from 'node:path';
import type { UpdateState } from '@shared/api';

const CHECK_EVERY_MS = 30 * 60_000;

let state: UpdateState = { readyVersion: null, status: 'idle' };
let notify: (s: UpdateState) => void = () => undefined;
/** Settings → autoUpdate: periodic checks and downloading on its own. */
let auto = true;

function set(patch: Partial<UpdateState>): void {
  state = { ...state, ...patch };
  notify(state);
}

export const updaterLogPath = (): string => path.join(app.getPath('userData'), 'updater.log');

function log(text: string): void {
  const line = `${new Date().toISOString()} ${text}\n`;
  try {
    fs.appendFileSync(updaterLogPath(), line);
  } catch {
    /* logging must never break the app */
  }
}

export const updateState = (): UpdateState => (app.isPackaged ? state : { ...state, status: 'dev' });

/** Looks for a new version, unless one is already downloading or downloaded. */
export function checkForUpdates(): UpdateState {
  if (!app.isPackaged) return updateState();
  if (state.status === 'checking' || state.status === 'downloading' || state.readyVersion) return state;
  set({ status: 'checking', error: undefined });
  autoUpdater.checkForUpdates().catch(() => undefined); // errors arrive via 'error'
  return state;
}

/** Downloads the version a check found while automatic updates were off. */
export function downloadUpdate(): UpdateState {
  if (state.status !== 'available') return state;
  log(`descarga ${state.newVersion} (a pedido)`);
  set({ status: 'downloading', progress: 0 });
  autoUpdater.downloadUpdate().catch(() => undefined); // errors arrive via 'error'
  return state;
}

/** Turns automatic updates on or off (Settings → autoUpdate). Turning them on downloads what a check already found. */
export function setAutoUpdate(on: boolean): void {
  if (on === auto) return;
  auto = on;
  autoUpdater.autoDownload = on;
  if (!app.isPackaged) return;
  log(on ? 'actualizaciones automáticas activadas' : 'actualizaciones automáticas desactivadas');
  if (on && state.status === 'available') downloadUpdate();
  else if (on) checkForUpdates();
}

export function startAutoUpdates(onChange: (s: UpdateState) => void, autoUpdate: boolean): void {
  auto = autoUpdate;
  // Development runs (npm run dev / start) have no installer to update.
  if (!app.isPackaged) return;
  notify = onChange;
  autoUpdater.autoDownload = auto;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => log(`revisa actualizaciones (versión actual ${app.getVersion()})`));
  autoUpdater.on('update-not-available', () => {
    log('sin actualizaciones');
    set({ status: 'latest', checkedAt: new Date().toISOString() });
  });
  autoUpdater.on('update-available', (info) => {
    const checkedAt = new Date().toISOString();
    if (autoUpdater.autoDownload) {
      log(`descarga ${info.version}`);
      set({ status: 'downloading', newVersion: info.version, progress: 0, checkedAt });
    } else {
      log(`${info.version} disponible; no se descarga (actualizaciones automáticas desactivadas)`);
      set({ status: 'available', newVersion: info.version, checkedAt });
    }
  });
  // Progress every 10 % in the log, so a slow or stuck download shows there; every whole % in the UI.
  let lastStep = -1;
  let lastPct = -1;
  autoUpdater.on('download-progress', (p) => {
    const pct = Math.floor(p.percent);
    if (pct !== lastPct) {
      lastPct = pct;
      set({ status: 'downloading', progress: pct });
    }
    const step = Math.floor(p.percent / 10);
    if (step === lastStep) return;
    lastStep = step;
    const mb = (n: number) => (n / 1_048_576).toFixed(0);
    log(`descargando: ${pct} % (${mb(p.transferred)} de ${mb(p.total)} MB, ${(p.bytesPerSecond / 1_048_576).toFixed(1)} MB/s)`);
  });
  autoUpdater.on('update-downloaded', (info) => {
    log(`${info.version} lista; se instala al cerrar AdFlow`);
    set({ status: 'ready', readyVersion: info.version, progress: undefined, newVersion: undefined });
  });
  autoUpdater.on('error', (err) => {
    const message = String(err?.message ?? err);
    log(`error: ${message}`);
    // Only the first line: electron-updater appends the whole HTTP response.
    set({ status: 'error', error: message.split('\n')[0].slice(0, 300), checkedAt: new Date().toISOString() });
  });
  if (auto) checkForUpdates();
  setInterval(() => auto && checkForUpdates(), CHECK_EVERY_MS);
}

export function restartToUpdate(): void {
  if (!state.readyVersion) return;
  log(`reinicia para instalar ${state.readyVersion}`);
  // Silent install, then AdFlow opens again in the new version. Deferred so the IPC call answers first.
  setImmediate(() => autoUpdater.quitAndInstall(true, true));
}
