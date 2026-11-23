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
