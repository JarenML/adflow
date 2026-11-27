// Types shared by the main process (Node) and the renderer (React).

export const STEPS = [
  { id: 'prep', label: 'Preparación', hint: 'Episodio, datos y conexiones' },
  { id: 'script', label: 'Guion', hint: 'Escenas, locución y transiciones' },
  { id: 'images', label: 'Imágenes', hint: 'Una imagen por escena' },
  { id: 'videos', label: 'Videos', hint: 'Clips del gancho y los diálogos' },
  { id: 'voice', label: 'Voz del narrador', hint: 'Voz, tomas y narración completa' },
  { id: 'render', label: 'Render final', hint: 'Montaje, mezcla y control de calidad' },
  { id: 'publish', label: 'Publicación', hint: 'Texto del anuncio, enlace y dónde se publicó' },
] as const;

export type StepId = (typeof STEPS)[number]['id'];
export const STEP_IDS: StepId[] = STEPS.map((s) => s.id);

/** locked: an earlier step is not approved · ready: can start · working: the brain or a provider is busy ·
 * review: waiting for the person · approved: done · error: last run failed. */
export type StepStatus = 'locked' | 'ready' | 'working' | 'review' | 'approved' | 'error';

export type Capability = 'brain' | 'image' | 'video' | 'voice' | 'music';

/** How a provider is paid for. Paid providers are blocked until the person enables them. */
export type Billing = 'subscription' | 'credits' | 'free' | 'manual';

export interface ProviderInfo {
  id: string;
  capability: Capability;
  name: string;
  description: string;
  billing: Billing;
  /** The adapter can actually produce output today (otherwise it is listed but disabled). */
  implemented: boolean;
  /** Secret key name needed in Settings, if any. */
  secret?: string;
  /** Short note about cost, shown next to estimates. */
  costNote: string;
  /** Lowest plan of the provider's account that can use it (e.g. "Creator"), shown as a tag. */
  minPlan?: string;
}

export interface StepState {
  status: StepStatus;
  updatedAt?: string;
  note?: string;
  error?: string;
}

export interface CostEntry {
  at: string;
  step: StepId;
  provider: string;
  label: string;
  /** USD equivalent reported by Claude Code (covered by the subscription), or provider credits. */
  usd?: number;
  credits?: number;
  /** Claude Code runs: tokens, model and time, as Claude Code reports them. */
  tokens?: { input: number; output: number; cacheRead: number; cacheWrite: number };
  model?: string;
  durationMs?: number;
}

export interface VoiceChoice {
  provider: string;
  voiceId: string;
  voiceName: string;
}

export interface VideoClipConfig {
  provider: string;
  model: string;
  durationS: number;
  resolution: '720p' | '1080p';
}

/** The four statuses the whole team sees (AdFlow and the admin). */
export type TeamStatus = 'pendiente' | 'en_produccion' | 'terminado' | 'publicado';

export interface Publication {
  network: string;
  date: string;
  url?: string;
  utmContent?: string;
  by?: string;
}

/** What AdFlow tells the episode source after every change (see shared/progress.ts). */
export interface TeamProgress {
  status: TeamStatus;
  step?: StepId;
  waitingForYou?: boolean;
  error?: boolean;
  publication?: Publication;
}

export interface EpisodeState {
  id: string;
  playbookId: string;
  /** Which episode source it came from and its stable id there. */
  source?: { id: string; episodeId: string };
  publication?: Publication;
  title: string;
  serie: string;
  slug: string;
  dir: string;
  caseNumber?: number;
  businessType?: string;
  solution?: string;
  createdAt: string;
  updatedAt: string;
  current: StepId;
  steps: Record<StepId, StepState>;
  providers: Record<Capability, string>;
  brain: { account: string; model: string; sessions: Partial<Record<StepId, string>> };
  voice?: VoiceChoice;
  /** Max ElevenLabs credits one narrator run may spend (it stops before passing it). */
  voiceCreditLimit?: number;
  /** Max HeyGen premium credits one narrator run may spend (worst case of its characters). */
  heygenCreditLimit?: number;
  closingVoice: 'narrator' | 'template';
  videoConfig?: VideoClipConfig;
  /** The 4:5 for the feeds is rendered with the 9:16 unless this is false (Preparación). */
  feed45?: boolean;
  costs: CostEntry[];
  versions: Partial<Record<StepId, number>>;
}

/** An episode as an episode source describes it (files of the playbook, the team admin…). */
export interface SourceEpisode {
  /** Stable id inside its source. */
  id: string;
  caseNumber?: number;
  businessType: string;
  solution: string;
  title: string;
  /** Short description: the label people see in lists. */
  summary: string;
  /** Folder of the episode relative to the episodes root, when the source knows it. */
  folder?: string;
  status: TeamStatus;
  /** Step label as the source knows it (e.g. "8 · Revisión" or "Imágenes"). */
  stepLabel?: string;
  /** The step it is on, when the source knows it (an episode someone else is producing). */
  step?: StepId;
  assignee?: string;
  publication?: Publication;
  notes?: string;
}

/** A row of the library: the source episode plus the local AdFlow episode linked to it, if any. */
export interface LibraryItem extends SourceEpisode {
  sourceId: string;
  episodeId?: string;
  /** The local episode's progress decides the status while it is in AdFlow. */
  progress?: TeamProgress;
}

export interface EpisodeSourceInfo {
  id: string;
  name: string;
  description: string;
  implemented: boolean;
  /** Shared with the team (statuses and assignees visible to everyone). */
  shared: boolean;
}

export interface Playbook {
  id: string;
  name: string;
  /** folder: read from a repo on this computer; team: downloaded from the team admin into AdFlow's storage. */
  origin?: 'folder' | 'team';
  /** Root of the repository that holds the playbook (e.g. a clone of robles.ai). */
  rootDir: string;
  masterPrompt: string;
  /** Where episode folders live, relative to rootDir unless absolute. */
  episodesRoot: string;
  toolsDir: string;
  /** AdFlow config inside the playbook repo (sections per step, script checks). Falls back to a preset. */
  configFile: string;
}

export interface ClaudeAccount {
  id: string;
  label: string;
  /** Empty = whatever Claude Code is signed in as on this computer. */
  configDir?: string;
}

export interface Settings {
  playbooks: Playbook[];
  activePlaybookId: string;
  /** Where the list of episodes comes from (see src/main/sources). */
  episodeSource: string;
  /** Team admin («Producción de redes»): its address and who the token belongs to. The token itself is a secret. */
  team: { url: string; userName?: string };
  claude: { model: string; effort: 'low' | 'medium' | 'high'; accounts: ClaudeAccount[]; defaultAccount: string };
  defaults: Record<Capability, string>;
  concurrency: ConcurrencySettings;
  /** Paid providers stay blocked until this is on (and each spend is still confirmed). */
  allowPaidProviders: boolean;
  userName: string;
  /** Where episode folders are created. Empty = AdFlow's own storage (<app data>/episodios). */
  storageDir: string;
  /** On: new versions are looked for every 30 minutes and downloaded alone. Off: only with «Buscar ahora», and downloaded on request. */
  autoUpdate: boolean;
}

/** State of the playbook copy downloaded from the team admin. */
export interface PlaybookSyncStatus {
  version?: string;
  files: number;
  syncedAt?: string;
  /** Files downloaded by the last sync. */
  changed?: number;
  error?: string;
  syncing?: boolean;
}

export interface ActivityEvent {
  episodeId: string;
  step: StepId;
  at: string;
  kind: 'start' | 'text' | 'tool' | 'result' | 'error' | 'info';
  text: string;
}

export interface DiagnosticItem {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  required: boolean;
}

/**
 * Kinds of work in the queue. brain: one Claude task (script, prompts, ad copy, assembling the
 * render). image: one image. clip: one video clip. voice: one batch of voices. render: one render phase.
 */
export type Lane = 'brain' | 'image' | 'clip' | 'voice' | 'render';

/**
 * How many images, clips and voice lines run at the same time in each episode (0 = all at once),
 * and how many episodes work at the same time whatever their step (0 = no limit).
 * Claude tasks are fixed at 1 per episode; render at 1 for the whole computer.
 */
export const MAX_RENDERS = 4;
/** Renders at the same time: at least 1 (render has no "no limit"), at most MAX_RENDERS. */
export const clampRenders = (n: number) => Math.min(MAX_RENDERS, Math.max(1, Math.round(Number(n)) || 1));

export interface ConcurrencySettings {
  image: number;
  clip: number;
  voice: number;
  /** Renders at the same time on this computer (1–4). They share the CPU. */
  render: number;
  episodes: number;
}

export interface QueueSnapshot {
  lanes: Record<Lane, { running: number; waiting: number; limit: number; scope: 'episode' | 'global' }>;
  /** Episodes working now (a job running) and the limit (0 = no limit). */
  episodes: { active: number; limit: number };
  jobs: { id: string; episodeId: string; step: StepId; label: string; lane: Lane; state: 'waiting' | 'running' }[];
}

export interface ImageItem {
  sceneId: string;
  file: string;
  prompt: string;
  references: string[];
  exists: boolean;
  url?: string;
  status: 'pending' | 'working' | 'done' | 'error';
  error?: string;
  description?: string;
  narration?: string;
  /** The script made this scene a video clip: the image is its first frame. */
  clip?: boolean;
}

/** A real scene of the script that stays as an image (it could become a clip). */
export interface ClipCandidate {
  sceneId: string;
  image: string;
  imageUrl?: string;
  description?: string;
}

export interface ClipItem {
  sceneId: string;
  image: string;
  imageUrl?: string;
  prompt: string;
  audio: boolean;
  durationS: number;
  reason: string;
  file: string;
  exists: boolean;
  url?: string;
  /** Generation state of this clip (pending until generated or uploaded). */
  status: 'pending' | 'working' | 'done' | 'error';
  error?: string;
  /** The ElevenLabs flow where it was generated (MCP), to keep editing it there. */
  flowUrl?: string;
}

export interface NarrationLine {
  id: string;
  sceneId: string;
  who: string;
  tone: string;
  text: string;
  file?: string;
  url?: string;
  durationS?: number;
  /** The audio says another text (the script changed after it was generated): it needs a new take. */
  stale?: boolean;
  /** What the audio says, when it is stale. */
  recordedText?: string;
}

export interface VoiceOption {
  id: string;
  name: string;
  language: string;
  gender?: string;
  description?: string;
  /** A sample recorded by the provider (ElevenLabs preview_url): listening to it is free. */
  previewUrl?: string;
}

/** Actions the renderer can ask the pipeline to run. */
export type PipelineAction =
  | { step: 'script'; type: 'generate' }
  | { step: 'script'; type: 'feedback'; message: string }
  | { step: 'script'; type: 'regenerate' }
  | { step: 'images'; type: 'prepare' }
  | { step: 'images'; type: 'generate'; sceneIds?: string[] }
  | { step: 'images'; type: 'feedback'; sceneId?: string; message: string }
  | { step: 'videos'; type: 'prepare' }
  | { step: 'videos'; type: 'feedback'; sceneId?: string; message: string }
  | { step: 'videos'; type: 'import'; sceneId: string }
  | { step: 'videos'; type: 'generate'; sceneIds?: string[] }
  /** Turn a scene of the script into a clip (tipo real_clip) and write its prompt. */
  | { step: 'videos'; type: 'addClip'; sceneId: string }
  /** Turn a clip scene back into an image (tipo real_imagen). */
  | { step: 'videos'; type: 'removeClip'; sceneId: string }
  | { step: 'voice'; type: 'preview'; text: string }
  | { step: 'voice'; type: 'generate'; lineIds?: string[] }
  | { step: 'render'; type: 'build' }
  | { step: 'render'; type: 'feedback'; message: string }
  | { step: 'render'; type: 'rerender' }
  | { step: 'publish'; type: 'adCopy' }
  | { step: 'publish'; type: 'feedback'; message: string }
  | { step: 'publish'; type: 'markPublished'; publication: Publication }
  | { step: 'publish'; type: 'unpublish' }
  | { step: StepId; type: 'approve' }
  | { step: StepId; type: 'reopen' }
  | { step: StepId; type: 'cancel' };

/** The last final render of an episode (.adflow/render.json). */
export interface RenderReport {
  at: string;
  file: string;
  durationS: number | null;
  sizeMB: number;
  mastered: boolean;
  note?: string;
  /** The 4:5 rendered with it (file in the episode folder), or why there is none. */
  feed?: { file: string; sizeMB: number } | null;
  feedNote?: string;
}
