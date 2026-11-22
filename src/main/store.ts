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

/** Section map of the Robles.AI master prompt (PROMPT_MAESTRO_VIDEO.md). */
export const ROBLES_SECTIONS: Pick<Playbook, 'always' | 'sections'> = {
  always: ['intro', '3', '5', '6', '9'],
  sections: {
    prep: ['0'],
    script: ['0', '1', '1-B', '1-C', '2', 'paso1', '4'],
    images: ['paso2'],
    videos: ['paso3', 'paso4', 'paso5'],
    voice: ['paso6'],
    render: ['paso7', 'paso8', 'paso9', '4', '7', '10'],
  },
};

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
    ...ROBLES_SECTIONS,
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
    claude: {
      model: 'opus',
      effort: 'medium',
      accounts: [{ id: 'system', label: 'Claude del sistema' }],
      defaultAccount: 'system',
    },
    defaults: { brain: 'claude-cli', image: 'codex-cli', video: 'manual', voice: 'windows-sapi', music: 'none' },
    concurrency: { brain: 2, image: 2, render: 1 },
    allowPaidProviders: false,
    userName: '',
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
    concurrency: { ...base.concurrency, ...saved.concurrency },
    playbooks: saved.playbooks?.length ? saved.playbooks : base.playbooks,
  };
  // A playbook saved before its root was found picks it up later.
  merged.playbooks = merged.playbooks.map((p) =>
    p.id === 'robles-ai' && !p.rootDir ? { ...p, rootDir: guessRoblesRoot() } : p,
  );
  return merged;
}

export function saveSettings(s: Settings): Settings {
  writeJson(settingsFile(), s);
  return s;
}

export function activePlaybook(s: Settings): Playbook {
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
