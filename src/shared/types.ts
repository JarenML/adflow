// Types shared by the main process (Node) and the renderer (React).

export const STEPS = [
  { id: 'prep', label: 'Preparación', hint: 'Episodio, datos y conexiones' },
  { id: 'script', label: 'Guion', hint: 'Escenas, locución y transiciones' },
  { id: 'images', label: 'Imágenes', hint: 'Un cuadro por escena real' },
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
  closingVoice: 'narrator' | 'template';
  videoConfig?: VideoClipConfig;
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
  /** Root of the repository that holds the playbook (e.g. a clone of robles.ai). */
  rootDir: string;
  masterPrompt: string;
  casesFile: string;
  trackingFile: string;
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
  concurrency: { brain: number; image: number; render: number };
  /** Paid providers stay blocked until this is on (and each spend is still confirmed). */
  allowPaidProviders: boolean;
  userName: string;
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

export interface QueueSnapshot {
  lanes: Record<'brain' | 'image' | 'render', { running: number; waiting: number; limit: number }>;
  jobs: { id: string; episodeId: string; step: StepId; label: string; lane: string; state: 'waiting' | 'running' }[];
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
}

export interface VoiceOption {
  id: string;
  name: string;
  language: string;
  gender?: string;
  description?: string;
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
  | { step: 'voice'; type: 'preview'; text: string }
  | { step: 'voice'; type: 'generate' }
  | { step: 'publish'; type: 'adCopy' }
  | { step: 'publish'; type: 'feedback'; message: string }
  | { step: 'publish'; type: 'markPublished'; publication: Publication }
  | { step: 'publish'; type: 'unpublish' }
  | { step: StepId; type: 'approve' }
  | { step: StepId; type: 'reopen' }
  | { step: StepId; type: 'cancel' };
