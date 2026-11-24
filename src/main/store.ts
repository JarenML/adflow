// Local persistence: settings and the index of episodes live in the app data folder; each
// episode's state lives inside its own folder (<episode>/.adflow/episode.json), next to its files.
import fs from 'node:fs';
import path from 'node:path';
import type { EpisodeState, Playbook, Settings, StepId } from '@shared/types';
import { STEP_IDS } from '@shared/types';

let dataDir = '';

export function initStore(dir: string): void {
  dataDir = dir;
  fs.mkdirSync(dataDir, { recursive: true });
}

export function getDataDir(): string {
  return dataDir;
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

/** Writes through a temp file so a crash never leaves half a JSON file behind. */
export function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

export function defaultPlaybook(rootDir = ''): Playbook {
  return {
    id: 'robles-ai',
    name: 'Robles.AI · Videos de redes',
    rootDir,
    masterPrompt: 'creative/social/PROMPT_MAESTRO_VIDEO.md',
    casesFile: 'creative/social/PROMPT_MAESTRO_CASOS.md',
    trackingFile: 'creative/social/SEGUIMIENTO_SERIES.md',
    episodesRoot: 'creative/social',
    toolsDir: 'creative/social/herramientas',
    configFile: 'adflow.playbook.json',
  };
}

function guessRoblesRoot(): string {
  const candidates = [process.env.ADFLOW_PLAYBOOK_ROOT, path.resolve(process.cwd(), '..', 'robles.ai')];
  for (const c of candidates) {
    if (c && fs.existsSync(path.join(c, 'creative', 'social', 'PROMPT_MAESTRO_VIDEO.md'))) return c;
  }
  return '';
}

export function defaultSettings(): Settings {
  return {
    playbooks: [defaultPlaybook(guessRoblesRoot())],
    activePlaybookId: 'robles-ai',
    episodeSource: 'playbook-files',
    team: { url: '' },
    claude: {
      model: 'opus',
      effort: 'medium',
      accounts: [{ id: 'system', label: 'Claude del sistema' }],
      defaultAccount: 'system',
    },
    defaults: { brain: 'claude-cli', image: 'codex-cli', video: 'manual', voice: 'windows-sapi', music: 'none' },
    concurrency: { image: 2, clip: 2, voice: 2, episodes: 3 },
    allowPaidProviders: false,
    userName: '',
    storageDir: '',
  };
}

const settingsFile = () => path.join(dataDir, 'settings.json');

export function loadSettings(): Settings {
  const base = defaultSettings();
  const saved = readJson<Partial<Settings>>(settingsFile(), {});
  const merged: Settings = {
    ...base,
    ...saved,
    claude: { ...base.claude, ...saved.claude },
    defaults: { ...base.defaults, ...saved.defaults },
    // Older settings also had brain and render (now fixed): only the configurable ones are kept.
    concurrency: {
      image: saved.concurrency?.image ?? base.concurrency.image,
      clip: saved.concurrency?.clip ?? base.concurrency.clip,
      voice: saved.concurrency?.voice ?? base.concurrency.voice,
      episodes: saved.concurrency?.episodes ?? base.concurrency.episodes,
    },
    team: { ...base.team, ...saved.team },
    playbooks: saved.playbooks?.length ? saved.playbooks : base.playbooks,
  };
  // A playbook saved before its root was found picks it up later.
  merged.playbooks = merged.playbooks.map((p) => {
    // Older settings kept the section map here; it now lives in the playbook config.
    const { always: _a, sections: _s, ...rest } = p as Playbook & { always?: unknown; sections?: unknown };
    const fixed = { ...rest, configFile: rest.configFile || 'adflow.playbook.json' };
    return fixed.id === 'robles-ai' && !fixed.rootDir ? { ...fixed, rootDir: guessRoblesRoot() } : fixed;
  });
  return merged;
}

export function saveSettings(s: Settings): Settings {
  writeJson(settingsFile(), s);
  return s;
}

/** Where new episode folders go: the folder chosen in Settings or AdFlow's own storage. */
export function episodesDir(s: Settings): string {
  return s.storageDir || path.join(dataDir, 'episodios');
}

// ── Team playbook: the copy downloaded from the admin (see teamPlaybook.ts) ─────────────────

export const teamPlaybookDir = () => path.join(dataDir, 'playbook-equipo');
export const teamPlaybookFiles = () => path.join(teamPlaybookDir(), 'archivos');
export const teamPlaybookStateFile = () => path.join(teamPlaybookDir(), 'estado.json');

export interface TeamPlaybookState {
  manifest?: {
    id: string;
    name: string;
    version: string;
    masterPrompt: string;
    casesFile: string;
    configFile: string;
    toolsDir: string;
    files: { path: string; size: number; sha256: string }[];
  };
  syncedAt?: string;
  changed?: number;
  error?: string;
}

export function readTeamPlaybookState(): TeamPlaybookState {
  return readJson<TeamPlaybookState>(teamPlaybookStateFile(), {});
}

/** The team playbook as AdFlow uses it: its rules from the downloaded copy, episodes in AdFlow's storage. */
export function teamPlaybook(s: Settings): Playbook {
  const m = readTeamPlaybookState().manifest;
  return {
    id: m?.id ?? 'robles-ai',
    name: m?.name ?? 'Playbook del equipo',
    origin: 'team',
    rootDir: m ? teamPlaybookFiles() : '',
    masterPrompt: m?.masterPrompt ?? 'creative/social/PROMPT_MAESTRO_VIDEO.md',
    casesFile: m?.casesFile ?? 'creative/social/PROMPT_MAESTRO_CASOS.md',
    // Not part of the package: the admin replaced the tracking file.
    trackingFile: 'creative/social/SEGUIMIENTO_SERIES.md',
    episodesRoot: episodesDir(s),
    toolsDir: m?.toolsDir ?? 'creative/social/herramientas',
    configFile: m?.configFile ?? 'creative/social/adflow.playbook.json',
  };
}

/** With the team admin as the source, the playbook comes from the admin too; otherwise from a folder. */
export function activePlaybook(s: Settings): Playbook {
  if (s.episodeSource === 'produccion-redes') return teamPlaybook(s);
  return s.playbooks.find((p) => p.id === s.activePlaybookId) ?? s.playbooks[0];
}

export function resolveIn(p: Playbook, rel: string): string {
  return path.isAbsolute(rel) ? rel : path.join(p.rootDir, rel);
}

// ── Episodes ─────────────────────────────────────────────────────────────────────────────────

const indexFile = () => path.join(dataDir, 'episodes.json');

export function episodeStateFile(dir: string): string {
  return path.join(dir, '.adflow', 'episode.json');
}

export function listEpisodeDirs(): string[] {
  return readJson<string[]>(indexFile(), []).filter((d) => fs.existsSync(episodeStateFile(d)));
}

export function loadEpisode(dir: string): EpisodeState | null {
  const e = readJson<EpisodeState | null>(episodeStateFile(dir), null);
  if (!e) return null;
  // Older files may miss newer steps.
  for (const id of STEP_IDS) e.steps[id] ??= { status: 'locked' };
  return { ...e, dir };
}

export function saveEpisode(e: EpisodeState): EpisodeState {
  e.updatedAt = new Date().toISOString();
  writeJson(episodeStateFile(e.dir), e);
  const dirs = readJson<string[]>(indexFile(), []);
  if (!dirs.includes(e.dir)) writeJson(indexFile(), [...dirs, e.dir]);
  return e;
}

export function newEpisodeSteps(): EpisodeState['steps'] {
  const steps = {} as EpisodeState['steps'];
  STEP_IDS.forEach((id: StepId, i) => {
    steps[id] = { status: i === 0 ? 'review' : 'locked' };
  });
  return steps;
}
