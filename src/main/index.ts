// Electron main process: window, local file protocol and the IPC handlers behind window.adflow.
import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { AdflowApi } from '@shared/api';
import { checkScript } from '@shared/playbookConfig';
import { runDiagnostics } from './diagnostics';
import { fileUrl, Pipeline } from './pipeline';
import { loadConfig, sectionStatus } from './playbook';
import { sourceInfos } from './sources';
import { checkTeamConnection, listFinalVideos, TEAM_TOKEN_SECRET, uploadFinalVideo } from './sources/teamAdmin';
import { PROVIDERS, SECRET_LABELS, estimate } from './providers/registry';
import { listVoices, voiceById, voiceSample } from './providers/voices';
import { getSecrets, secretStatus, setSecret } from './secrets';
import { activePlaybook, episodesDir, getDataDir, initStore, loadSettings, saveSettings } from './store';
import { syncTeamPlaybook, teamPlaybookStatus } from './teamPlaybook';
import { checkForUpdates, downloadUpdate, restartToUpdate, setAutoUpdate, startAutoUpdates, updateState } from './updater';
import { claudeUsage, initClaudeLimits, needsReading, setRefreshing, showAccount, signedInAccount } from './brain/claudeLimits';
import { probeClaudeLimits } from './brain/claudeCli';
// Where updates are published (electron-builder's publish config), to link to its releases page.
import { build as pkgBuild } from '../../package.json';

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
    // Installed copies take the icon of AdFlow.exe; development runs (electron.exe) need it set.
    icon: app.isPackaged ? undefined : path.join(__dirname, '../../build/icon.png'),
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
        // ADFLOW_SNAPSHOT_SCROLL=<px> scrolls the main area first, to check what is below the fold.
        const scroll = Number(process.env.ADFLOW_SNAPSHOT_SCROLL ?? 0);
        if (scroll) {
          await win!.webContents.executeJavaScript(`document.querySelector('main')?.scrollTo(0, ${scroll})`);
          await new Promise((r) => setTimeout(r, 400));
        }
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
    setAutoUpdate(saved.autoUpdate);
    return saved;
  });
  handle('setSecret', (name: string, value: string) => {
    setSecret(name, value);
    return secretStatus();
  });
  handle('secretStatus', () => secretStatus());
  handle('secretLabels', () => SECRET_LABELS);
  handle('providers', () => PROVIDERS);
  handle('estimate', (id: string, units: number, model?: string) => estimate(id, units, model));
  handle('diagnostics', () => runDiagnostics(loadSettings()));
  handle('playbookSections', () => sectionStatus(activePlaybook(loadSettings())));
  handle('playbookConfigOrigin', () => { const c = loadConfig(activePlaybook(loadSettings())); return { origin: c.origin, error: c.error }; });
  handle('episodeSources', () => sourceInfos());
  handle('teamConnect', async (url: string, newToken?: string) => {
    const s = loadSettings();
    saveSettings({ ...s, team: { ...s.team, url: url.trim() } });
    if (newToken) setSecret(TEAM_TOKEN_SECRET, newToken.trim());
    const me = await checkTeamConnection();
    const after = loadSettings();
    saveSettings({ ...after, team: { ...after.team, userName: me.name } });
    void syncTeamPlaybook();
    return me;
  });
  handle('playbookStatus', () => teamPlaybookStatus());
  handle('playbookSync', () => syncTeamPlaybook());
  handle('storagePath', () => episodesDir(loadSettings()));
  handle('adCopy', (id: string) => pipeline.adCopy(id));
  handle('finalVideo', (id: string) => pipeline.finalVideo(id));
  handle('feedVideo', (id: string) => pipeline.feedVideo(id));
  handle('hasProject', (id: string) => pipeline.hasProject(id));
  handle('cropFeed', (id: string) => pipeline.cropFeed(id));
  // «Subir video final»: only episodes of Producción de redes have somewhere to go.
  const teamEpisode = (id: string) => {
    const e = pipeline.get(id);
    return e.source?.id === 'produccion-redes' ? e.source.episodeId : null;
  };
  handle('finalVideoUploads', async (id: string) => {
    const remote = teamEpisode(id);
    if (!remote) return { team: false, storage: false, videos: [] };
    try {
      const r = await listFinalVideos(remote);
      return { team: true, storage: r.storage, videos: r.videos };
    } catch (err) {
      return { team: true, storage: false, videos: [], error: String((err as Error).message ?? err) };
    }
  });
  handle('uploadFinalVideo', async (id: string) => {
    const remote = teamEpisode(id);
    if (!remote) throw new Error('Este episodio no es de Producción de redes: no hay dónde subir el video final.');
    const video = pipeline.finalVideo(id);
    if (!video) throw new Error('Aún no hay video final (.mp4) en la carpeta del episodio.');
    const dir = pipeline.get(id).dir;
    const feed = pipeline.feedVideo(id);
    const files = [{ path: path.join(dir, video.file), format: '9x16' as const }, ...(feed ? [{ path: path.join(dir, feed.file), format: '4x5' as const }] : [])];
    let last = 0;
    return uploadFinalVideo(remote, files, (sent, total) => {
      // About 4 updates per second is plenty for a progress bar.
      if (sent === total || Date.now() - last > 250) {
        last = Date.now();
        broadcast('videoUpload', { episodeId: id, sent, total });
      }
    });
  });
  handle('renderReport', (id: string) => pipeline.renderReport(id));
  handle('library', () => pipeline.library());
  handle('sourceBrief', (id: string) => pipeline.sourceBrief(id));
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
  handle('clipCandidates', (id: string) => pipeline.clipCandidates(id));
  handle('narration', (id: string) => pipeline.narration(id));
  handle('voices', (providerId: string, refresh?: boolean) => listVoices(providerId, getSecrets(), { dataDir: getDataDir(), refresh }));
  handle('previewVoice', (id: string, text: string) => pipeline.previewVoice(id, text));
  // The provider's recorded sample of a voice (free): downloaded once, played from disk.
  handle('voiceById', (providerId: string, voiceId: string) => voiceById(providerId, voiceId, getSecrets(), { dataDir: getDataDir() }));
  handle('voiceSample', async (voiceId: string, previewUrl: string) => fileUrl(await voiceSample(getDataDir(), voiceId, previewUrl)));
  handle('openPath', (p: string) => (/^https?:\/\//.test(p) ? shell.openExternal(p) : shell.openPath(p).then(() => undefined)));
  handle('pickFolder', async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  handle('appInfo', () => {
    const { publish } = pkgBuild;
    return {
      version: app.getVersion(),
      packaged: app.isPackaged,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: `${process.platform} ${process.arch}`,
      dataDir: app.getPath('userData'),
      releasesUrl: `https://github.com/${publish.owner}/${publish.repo}/releases`,
      ...updateState(),
    };
  });
  handle('restartToUpdate', () => restartToUpdate());
  handle('checkForUpdates', () => checkForUpdates());
  handle('downloadUpdate', () => downloadUpdate());
  handle('claudeUsage', () => claudeUsage());
  handle('refreshClaudeUsage', () => refreshClaudeUsage());
  handle('defaults', (cap) => loadSettings().defaults[cap as keyof ReturnType<typeof loadSettings>['defaults']]);
}

/** The config dir of the default Claude account in Settings (undefined = Claude Code's own sign-in). */
function defaultClaudeDir(): string | undefined {
  const { claude } = loadSettings();
  return claude.accounts.find((a) => a.id === claude.defaultAccount)?.configDir || undefined;
}

let refreshingUsage: Promise<ReturnType<typeof claudeUsage>> | null = null;
function refreshClaudeUsage() {
  refreshingUsage ??= (async () => {
    const configDir = defaultClaudeDir();
    showAccount(configDir);
    setRefreshing(true);
    try {
      const cwd = path.join(app.getPath('userData'), 'claude-probe');
      fs.mkdirSync(cwd, { recursive: true });
      await probeClaudeLimits(cwd, configDir);
    } finally {
      setRefreshing(false);
      refreshingUsage = null;
    }
    return claudeUsage();
  })();
  return refreshingUsage;
}

/**
 * The limits only arrive with a Claude request, so when Claude Code is signed into another account (or
 * the default account changes) the panel would keep the previous one's numbers. Every 30 s: follow the
 * default account, and read an account once if it has never been read.
 */
function watchClaudeAccount() {
  let last: string | undefined;
  const tried = new Set<string>();
  const tick = () => {
    const configDir = defaultClaudeDir();
    showAccount(configDir);
    const key = `${configDir ?? ''}|${signedInAccount(configDir)?.id ?? ''}`;
    if (key !== last) {
      last = key;
      broadcast('claudeUsage', claudeUsage());
    }
    const unread = needsReading();
    if (unread && !tried.has(unread.id)) {
      tried.add(unread.id);
      void refreshClaudeUsage().catch(() => {});
    }
  };
  tick();
  setInterval(tick, 30_000);
}

app.setName('AdFlow');
if (process.env.ADFLOW_DATA_DIR) app.setPath('userData', process.env.ADFLOW_DATA_DIR);

void app.whenReady().then(() => {
  initStore(app.getPath('userData'));
  initClaudeLimits(app.getPath('userData'), (u) => broadcast('claudeUsage', u));
  watchClaudeAccount();

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
  startAutoUpdates((u) => broadcast('update', u), loadSettings().autoUpdate);
  // The team playbook is refreshed in the background at every start.
  if (loadSettings().episodeSource === 'produccion-redes') void syncTeamPlaybook();
});

app.on('window-all-closed', () => app.quit());
