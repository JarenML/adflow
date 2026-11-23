// Episode source «Producción de redes»: the team's episodes in the robles.ai admin (/admin/social),
// read and updated through its AdFlow API with the person's personal token. Shared with the team:
// taking an episode assigns it, and every change of status is reported. Reports that cannot be sent
// (no connection) wait in an outbox and go out with the next call.
import fs from 'node:fs';
import path from 'node:path';
import type { Playbook, SourceEpisode, StepId, TeamProgress, TeamStatus } from '@shared/types';
import { stepLabel } from '@shared/progress';
import { getDataDir, loadSettings, writeJson } from '../store';
import { playbookFilesSource } from './playbookFiles';
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
  casesFile: string;
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
  if (!url) throw new Error('Falta la dirección del admin en Ajustes → Fuente de episodios.');
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
  if (!t) throw new TeamApiError('Falta el token de AdFlow: généralo en el admin (Producción de redes → Conectar AdFlow).', 401);
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}/api/adflow${route}`, {
      method: init.method ?? 'GET',
      headers: { Authorization: `Bearer ${t}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new TeamApiError(`No se pudo conectar con el admin (${baseUrl()}): ${String((err as Error).message ?? err)}`, 0);
  }
  const json = (await res.json().catch(() => ({}))) as { error?: string; code?: string; by?: string };
  if (!res.ok) {
    const msg =
      json.code === 'social_episode_taken'
        ? `Este episodio ya lo tiene ${json.by ?? 'otra persona'}.`
        : json.code === 'adflow_unauthorized'
          ? 'El token de AdFlow no es válido o fue revocado.'
          : json.code === 'adflow_forbidden'
            ? 'Tu usuario no tiene acceso a Producción de redes.'
            : (json.error ?? `El admin respondió ${res.status}`);
    throw new TeamApiError(msg, res.status, json.code);
  }
  return json as T;
}

const remoteId = (episodeId: string) => Number(episodeId.replace(/^team:/, ''));

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
  if (!res.ok) throw new TeamApiError(`El admin no entregó ${rel} (${res.status})`, res.status);
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
  name: 'Producción de redes (admin)',
  description: 'Episodios del equipo en el admin: quién lleva cada uno, en qué paso va y cuáles están publicados.',
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
      assignee: r.assigneeName ?? undefined,
      publication: r.publication ? { network: r.publication.network, date: r.publication.date, url: r.publication.url ?? undefined, utmContent: r.publication.utmContent ?? undefined } : undefined,
    }));
  },

  async brief(p: Playbook, episodeId: string): Promise<string> {
    const r = await api<RemoteEpisode>(`/episodes/${remoteId(episodeId)}`);
    if (r.brief?.trim()) return r.brief;
    // Episodes created in the admin carry only a title and summary: add the catalog's series facts.
    const facts = await playbookFilesSource.brief(p, '').catch(() => '');
    return [`## «${r.title}» (${r.businessType})`, r.summary, facts].filter(Boolean).join('\n\n');
  },

  async script(_p, episodeId) {
    const r = await api<RemoteEpisode>(`/episodes/${remoteId(episodeId)}`);
    return r.scriptText ? { guion: r.scriptText.guion, escenas: r.scriptText.escenas } : null;
  },

  async saveScript(_p, episodeId, s) {
    if (s.guion.length > SCRIPT_LIMITS.guion || (s.escenas?.length ?? 0) > SCRIPT_LIMITS.escenas) {
      throw new Error('El guion es demasiado largo para guardarlo en el admin.');
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
