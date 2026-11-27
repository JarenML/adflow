// Episode source «Producción de redes»: the team's episodes in the robles.ai admin (/admin/social),
// read and updated through its AdFlow API with the person's personal token. Shared with the team:
// taking an episode assigns it, and every change of status is reported. Reports that cannot be sent
// (no connection) wait in an outbox and go out with the next call.
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import type { Playbook, SourceEpisode, StepId, TeamProgress, TeamStatus } from '@shared/types';
import { stepLabel } from '@shared/progress';
import { videoContentType, type RemoteVideo, type VideoFormat } from '@shared/finalVideo';
import { getDataDir, loadSettings, writeJson } from '../store';
import type { EpisodeSource } from './types';

/** What the admin returns for an episode (shared/socialProduction.ts in robles.ai). */
interface RemoteEpisode {
  id: number;
  businessType: string;
  number: number;
  title: string;
  summary: string;
  caseNumber: number | null;
  solution: string | null;
  folder: string | null;
  status: TeamStatus;
  step: StepId | null;
  assigneeName: string | null;
  publication: { network: string; date: string; url: string | null; utmContent: string | null } | null;
  brief?: string;
  scriptText?: { guion: string; escenas: string | null; at: string; by: string | null } | null;
}

/** What GET /api/adflow/playbook returns (PlaybookManifest in robles.ai). */
export interface PlaybookManifest {
  id: string;
  name: string;
  version: string;
  masterPrompt: string;
  configFile: string;
  toolsDir: string;
  files: { path: string; size: number; sha256: string }[];
}

export const TEAM_TOKEN_SECRET = 'team-token';

/** The personal token: ADFLOW_TEAM_TOKEN (tests, scripts) or the encrypted secret saved in Settings. */
function token(): string {
  if (process.env.ADFLOW_TEAM_TOKEN) return process.env.ADFLOW_TEAM_TOKEN;
  // Loaded lazily: secrets need Electron's safeStorage.
  const { getSecrets } = require('../secrets') as typeof import('../secrets');
  return getSecrets()[TEAM_TOKEN_SECRET] ?? '';
}

function baseUrl(): string {
  const url = process.env.ADFLOW_TEAM_URL || loadSettings().team.url;
  if (!url) throw new Error('Falta la dirección del panel de administración en Ajustes → Playbook.');
  return url.replace(/\/+$/, '');
}

export class TeamApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

async function api<T>(route: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const t = token();
  if (!t) throw new TeamApiError('Falta el token de AdFlow. Genéralo en el panel de administración (Producción de redes → Conectar AdFlow).', 401);
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}/api/adflow${route}`, {
      method: init.method ?? 'GET',
      headers: { Authorization: `Bearer ${t}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new TeamApiError(`No se pudo conectar con el panel de administración (${baseUrl()}): ${String((err as Error).message ?? err)}`, 0);
  }
  const json = (await res.json().catch(() => ({}))) as { error?: string; code?: string; by?: string };
  if (!res.ok) {
    const msg =
      json.code === 'social_episode_taken'
        ? `Este episodio ya está asignado a ${json.by ?? 'otra persona'}.`
        : json.code === 'adflow_unauthorized'
          ? 'El token de AdFlow no es válido o fue revocado.'
          : json.code === 'adflow_forbidden'
            ? 'Tu usuario no tiene acceso a Producción de redes.'
            : json.code && VIDEO_ERRORS[json.code]
              ? VIDEO_ERRORS[json.code]
              : (json.error ?? `El panel de administración respondió con el código ${res.status}.`);
    throw new TeamApiError(msg, res.status, json.code);
  }
  return json as T;
}

const remoteId = (episodeId: string) => Number(episodeId.replace(/^team:/, ''));

/** What the admin answers when a final video cannot be uploaded (codes of robles.ai's socialRoutes). */
const VIDEO_ERRORS: Record<string, string> = {
  social_video_storage_off: 'El panel de administración todavía no tiene configurado el almacenamiento de videos.',
  social_video_too_big: 'El video es demasiado grande para subirlo.',
  social_video_bad_type: 'Solo se pueden subir videos MP4, MOV o WebM.',
  social_video_bad_key: 'El panel de administración no reconoció la subida.',
  social_video_missing: 'El archivo no llegó al almacenamiento. Vuelve a intentarlo.',
  social_video_storage_error: 'Google Cloud Storage no respondió. Vuelve a intentarlo.',
};

// ── Final video («Subir video final») ────────────────────────────────────────────────────────

/** The versions of the final video the admin keeps, and whether it has a bucket. */
export function listFinalVideos(episodeId: string) {
  return api<{ videos: RemoteVideo[]; storage: boolean }>(`/episodes/${remoteId(episodeId)}/videos`);
}

/** PUTs the file to the signed URL, reporting bytes sent. Content-Length is set, as the URL expects. */
function putFile(url: string, file: string, contentType: string, size: number, onProgress: (sent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'PUT', headers: { 'Content-Type': contentType, 'Content-Length': size }, timeout: 120_000 }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () =>
        res.statusCode && res.statusCode < 300
          ? resolve()
          : reject(new TeamApiError(`El almacenamiento rechazó el video (${res.statusCode}). ${/<Message>([^<]+)/.exec(body)?.[1] ?? ''}`.trim(), res.statusCode ?? 0)),
      );
    });
    req.on('timeout', () => req.destroy(new Error('la conexión se quedó sin respuesta')));
    req.on('error', (err) => reject(new TeamApiError(`Se cortó la subida del video: ${err.message}`, 0)));
    let sent = 0;
    const stream = fs.createReadStream(file);
    stream.on('data', (chunk) => {
      sent += chunk.length;
      onProgress(sent);
    });
    stream.on('error', (err) => req.destroy(err));
    stream.pipe(req);
  });
}

/**
 * Uploads the final video in every format it has (9:16 and 4:5) as one version: asks the admin for a
 * signed URL per file (one file, a few minutes), sends each straight to the bucket and tells the admin
 * they are there, which records them together as the current version.
 */
export async function uploadFinalVideo(
  episodeId: string,
  files: { path: string; format: VideoFormat }[],
  onProgress: (sent: number, total: number) => void,
): Promise<RemoteVideo[]> {
  const list = files.map((f) => {
    const contentType = videoContentType(f.path);
    if (!contentType) throw new TeamApiError(VIDEO_ERRORS.social_video_bad_type, 400, 'social_video_bad_type');
    return { ...f, contentType, size: fs.statSync(f.path).size };
  });
  const total = list.reduce((n, f) => n + f.size, 0);
  const id = remoteId(episodeId);
  const target = await api<{ uploads: { format: VideoFormat; uploadUrl: string; objectKey: string; contentType: string }[] }>(`/episodes/${id}/video/upload-url`, {
    method: 'POST',
    body: { files: list.map((f) => ({ format: f.format, size: f.size, contentType: f.contentType })) },
  });
  onProgress(0, total);
  let done = 0;
  for (const f of list) {
    const u = target.uploads.find((x) => x.format === f.format);
    if (!u) throw new TeamApiError('El panel de administración no devolvió dónde subir el video.', 500);
    await putFile(u.uploadUrl, f.path, u.contentType, f.size, (sent) => onProgress(done + sent, total));
    done += f.size;
  }
  const r = await api<{ videos: RemoteVideo[] }>(`/episodes/${id}/video/complete`, {
    method: 'POST',
    body: { objects: list.map((f) => ({ objectKey: target.uploads.find((x) => x.format === f.format)!.objectKey, fileName: path.basename(f.path) })) },
  });
  return r.videos;
}

export const fetchPlaybookManifest = () => api<PlaybookManifest>('/playbook');

/** One file of the team playbook, as bytes. */
export async function fetchPlaybookFile(rel: string): Promise<Buffer> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}/api/adflow/playbook/file?path=${encodeURIComponent(rel)}`, {
      headers: { Authorization: `Bearer ${token()}` },
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    throw new TeamApiError(`No se pudo descargar ${rel}: ${String((err as Error).message ?? err)}`, 0);
  }
  if (!res.ok) throw new TeamApiError(`El panel de administración no devolvió ${rel} (${res.status}).`, res.status);
  return Buffer.from(await res.arrayBuffer());
}

/** Limits of the admin (SCRIPT_LIMITS in robles.ai). */
const SCRIPT_LIMITS = { guion: 40_000, escenas: 55_000 };

// Scripts that could not be sent yet wait here (the latest per episode).
const scriptOutboxFile = () => path.join(getDataDir(), 'team-script-outbox.json');

function readScriptOutbox(): Record<string, { guion: string; escenas: string | null }> {
  try {
    return JSON.parse(fs.readFileSync(scriptOutboxFile(), 'utf8'));
  } catch {
    return {};
  }
}

function sendScript(episodeId: string, s: { guion: string; escenas: string | null }) {
  return api(`/episodes/${remoteId(episodeId)}/script`, { method: 'PUT', body: s });
}

async function flushScripts(): Promise<void> {
  const box = readScriptOutbox();
  if (!Object.keys(box).length) return;
  for (const [id, s] of Object.entries(box)) {
    try {
      await sendScript(id, s);
      delete box[id];
    } catch (err) {
      if (err instanceof TeamApiError && err.status === 0) break;
      delete box[id];
    }
  }
  writeJson(scriptOutboxFile(), box);
}

// ── Outbox: progress that could not be sent yet (only the latest per episode) ─────────────────

const outboxFile = () => path.join(getDataDir(), 'team-outbox.json');

function readOutbox(): Record<string, TeamProgress> {
  try {
    return JSON.parse(fs.readFileSync(outboxFile(), 'utf8'));
  } catch {
    return {};
  }
}

async function flushOutbox(): Promise<void> {
  const box = readOutbox();
  for (const [id, progress] of Object.entries(box)) {
    try {
      await sendProgress(id, progress);
      delete box[id];
    } catch (err) {
      // Connection problems keep it for later; a rejected report (taken, invalid) is dropped.
      if (err instanceof TeamApiError && err.status === 0) break;
      delete box[id];
    }
  }
  writeJson(outboxFile(), box);
}

function sendProgress(episodeId: string, p: TeamProgress) {
  return api(`/episodes/${remoteId(episodeId)}/progress`, {
    method: 'POST',
    body: {
      status: p.status,
      step: p.step ?? null,
      waitingForYou: !!p.waitingForYou,
      error: !!p.error,
      publication: p.publication ? { network: p.publication.network, date: p.publication.date, url: p.publication.url ?? null, utmContent: p.publication.utmContent ?? null } : null,
    },
  });
}

/** Checks the address and token; returns who the token belongs to. */
export async function checkTeamConnection(): Promise<{ name: string; email: string }> {
  return api<{ name: string; email: string }>('/me');
}

export const teamAdminSource: EpisodeSource = {
  id: 'produccion-redes',
  name: 'Producción de redes',
  description: 'Episodios del equipo: responsable, paso actual y estado de publicación.',
  implemented: true,
  shared: true,

  async list(): Promise<SourceEpisode[]> {
    await flushOutbox().catch(() => {});
    await flushScripts().catch(() => {});
    const rows = await api<RemoteEpisode[]>('/episodes');
    return rows.map((r) => ({
      id: `team:${r.id}`,
      caseNumber: r.caseNumber ?? undefined,
      businessType: r.businessType,
      solution: r.solution ?? '',
      title: r.title,
      summary: r.summary,
      folder: r.folder ?? undefined,
      status: r.status,
      stepLabel: r.status === 'en_produccion' && r.step ? stepLabel(r.step) : undefined,
      step: r.step ?? undefined,
      assignee: r.assigneeName ?? undefined,
      publication: r.publication ? { network: r.publication.network, date: r.publication.date, url: r.publication.url ?? undefined, utmContent: r.publication.utmContent ?? undefined } : undefined,
    }));
  },

  async brief(_p: Playbook, episodeId: string): Promise<string> {
    const r = await api<RemoteEpisode>(`/episodes/${remoteId(episodeId)}`);
    // Episodes created in the admin carry only a title and a summary.
    return r.brief?.trim() || r.summary;
  },

  async script(_p, episodeId) {
    const r = await api<RemoteEpisode>(`/episodes/${remoteId(episodeId)}`);
    return r.scriptText ? { guion: r.scriptText.guion, escenas: r.scriptText.escenas } : null;
  },

  async saveScript(_p, episodeId, s) {
    if (s.guion.length > SCRIPT_LIMITS.guion || (s.escenas?.length ?? 0) > SCRIPT_LIMITS.escenas) {
      throw new Error('El guion es demasiado largo para guardarlo en el panel de administración.');
    }
    try {
      await sendScript(episodeId, s);
    } catch (err) {
      if (err instanceof TeamApiError && err.status === 0) {
        writeJson(scriptOutboxFile(), { ...readScriptOutbox(), [episodeId]: s });
        return;
      }
      throw err;
    }
  },

  async claim(_p, episodeId) {
    await api(`/episodes/${remoteId(episodeId)}/claim`, { method: 'POST' });
  },

  async report(_p, episodeId, progress) {
    try {
      await flushOutbox();
      await sendProgress(episodeId, progress);
    } catch (err) {
      if (err instanceof TeamApiError && err.status === 0) {
        writeJson(outboxFile(), { ...readOutbox(), [episodeId]: progress });
        return;
      }
      throw err;
    }
  },
};
