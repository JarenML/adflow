// Electron main process: window, local file protocol and the IPC handlers behind window.adflow.
import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { AdflowApi } from '@shared/api';
import { checkScript } from '@shared/playbookConfig';
import { runDiagnostics } from './diagnostics';
import { Pipeline } from './pipeline';
import { loadConfig, sectionStatus } from './playbook';
import { sourceInfos } from './sources';
import { PROVIDERS, SECRET_LABELS, estimate } from './providers/registry';
import { listVoices } from './providers/voices';
import { getSecrets, secretStatus, setSecret } from './secrets';
import { activePlaybook, initStore, loadSettings, saveSettings } from './store';

protocol.registerSchemesAsPrivileged([
  { scheme: 'adflow', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

let win: BrowserWindow | null = null;
let pipeline: Pipeline;

const broadcast = (channel: string, payload: unknown) => {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(`adflow:event:${channel}`, payload);
};

function createWindow() {
  win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#07080c',
    title: 'AdFlow',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#07080c', symbolColor: '#a1a1aa', height: 40 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false,
    },
  });
  win.once('ready-to-show', () => win?.show());
  const devUrl = process.env.ADFLOW_DEV_URL;
  const query = process.env.ADFLOW_ROUTE ? `#${process.env.ADFLOW_ROUTE}` : '';
  if (devUrl) void win.loadURL(devUrl + query);
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'), { hash: process.env.ADFLOW_ROUTE });

  // Screenshot mode for automated checks: ADFLOW_SNAPSHOT=<png> captures the window and quits.
  const snap = process.env.ADFLOW_SNAPSHOT;
  if (snap || devUrl) {
    // Renderer errors go to the terminal in development and screenshot runs.
    win.webContents.on('console-message', (e) => {
      const { level, message } = e as unknown as { level: string; message: string };
      if (level === 'error' || level === 'warning') console.log(`[renderer ${level}] ${message}`);
    });
  }
  if (snap) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const img = await win!.webContents.capturePage();
        fs.writeFileSync(snap, img.toPNG());
        app.quit();
      }, Number(process.env.ADFLOW_SNAPSHOT_DELAY ?? 2500));
    });
  }
}

function handle<K extends keyof AdflowApi>(name: K, fn: (...args: any[]) => unknown) {
  ipcMain.handle(`adflow:${name}`, (_e, ...args) => fn(...args));
}

function registerIpc() {
  handle('getSettings', () => loadSettings());
  handle('saveSettings', (s) => {
    const saved = saveSettings(s);
    pipeline.queue.setLimits(saved.concurrency);
    return saved;
  });
  handle('setSecret', (name: string, value: string) => {
    setSecret(name, value);
    return secretStatus();
  });
  handle('secretStatus', () => secretStatus());
  handle('secretLabels', () => SECRET_LABELS);
  handle('providers', () => PROVIDERS);
  handle('estimate', (id: string, units: number) => estimate(id, units));
  handle('diagnostics', () => runDiagnostics(loadSettings()));
  handle('playbookSections', () => sectionStatus(activePlaybook(loadSettings())));
  handle('playbookConfigOrigin', () => { const c = loadConfig(activePlaybook(loadSettings())); return { origin: c.origin, error: c.error }; });
  handle('episodeSources', () => sourceInfos());
  handle('adCopy', (id: string) => pipeline.adCopy(id));
  handle('finalVideo', (id: string) => pipeline.finalVideo(id));
  handle('library', () => pipeline.library());
  handle('episodes', () => pipeline.list());
  handle('episode', (id: string) => pipeline.get(id));
  handle('createEpisode', (sourceEpisodeId: string) => pipeline.createFromSource(sourceEpisodeId));
  handle('patchEpisode', (id: string, patch) => pipeline.patch(id, patch));
  handle('act', (id: string, action) => {
    // Long actions run in the background; progress arrives as events.
    pipeline.act(id, action).catch((err) => broadcast('activity', { episodeId: id, step: action.step, at: new Date().toISOString(), kind: 'error', text: String(err?.message ?? err) }));
  });
  handle('activity', (id: string) => pipeline.recentActivity(id));
  handle('queue', () => pipeline.queue.snapshot());
  handle('script', (id: string) => {
    const r = pipeline.script(id);
    return { ...r, checks: r.script ? checkScript(r.script, loadConfig(activePlaybook(loadSettings())).config) : [] };
  });
  handle('images', (id: string) => pipeline.images(id));
  handle('clips', (id: string) => pipeline.clips(id));
  handle('narration', (id: string) => pipeline.narration(id));
  handle('voices', (providerId: string) => listVoices(providerId, getSecrets()));
  handle('previewVoice', (id: string, text: string) => pipeline.previewVoice(id, text));
  handle('openPath', (p: string) => (/^https?:\/\//.test(p) ? shell.openExternal(p) : shell.openPath(p).then(() => undefined)));
  handle('pickFolder', async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  handle('defaults', (cap) => loadSettings().defaults[cap as keyof ReturnType<typeof loadSettings>['defaults']]);
}

app.setName('AdFlow');
if (process.env.ADFLOW_DATA_DIR) app.setPath('userData', process.env.ADFLOW_DATA_DIR);

void app.whenReady().then(() => {
  initStore(app.getPath('userData'));

  // adflow://file/<encoded file:// URL> serves local episode files (images, clips, audio).
  protocol.handle('adflow', (req) => {
    const url = new URL(req.url);
    if (url.hostname !== 'file') return new Response('Not found', { status: 404 });
    const target = decodeURIComponent(url.pathname.slice(1));
    return net.fetch(target, { headers: req.headers });
  });

  pipeline = new Pipeline({
    episode: (e) => broadcast('episode', e),
    activity: (a) => broadcast('activity', a),
    queue: (q) => broadcast('queue', q),
    pickFile: async (title, extensions) => {
      const r = await dialog.showOpenDialog(win!, { title, properties: ['openFile'], filters: [{ name: 'Video', extensions }] });
      return r.canceled ? null : r.filePaths[0];
    },
  });
  registerIpc();
  createWindow();
});

app.on('window-all-closed', () => app.quit());
