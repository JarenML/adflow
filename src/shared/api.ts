// The bridge between the UI and the main process (exposed by the preload as window.adflow).
import type {
  ActivityEvent,
  Capability,
  ClipCandidate,
  ClipItem,
  DiagnosticItem,
  EpisodeSourceInfo,
  EpisodeState,
  ImageItem,
  LibraryItem,
  NarrationLine,
  PipelineAction,
  PlaybookSyncStatus,
  ProviderInfo,
  QueueSnapshot,
  RenderReport,
  Settings,
  VoiceOption,
} from './types';
import type { Script, ScriptCheck } from './schemas';
import type { FinalVideoUploads, RemoteVideo, VideoUploadProgress } from './finalVideo';

/** An update downloaded and installed when AdFlow closes (or now, with restartToUpdate). */
export interface UpdateState {
  readyVersion: string | null;
  /** dev: running from source, there is nothing to update. */
  /** available: found but not downloaded, because automatic updates are off. */
  status: 'dev' | 'idle' | 'checking' | 'latest' | 'available' | 'downloading' | 'ready' | 'error';
  /** The version found or being downloaded (status 'available' or 'downloading'). */
  newVersion?: string;
  /** 0–100 while downloading. */
  progress?: number;
  /** When the last check finished (ISO). */
  checkedAt?: string;
  error?: string;
}

/** One usage limit of the Claude account, as Claude Code reports it. */
export interface LimitWindow {
  /** 0–100 */
  pct: number;
  /** When the window resets (ms since epoch). */
  resetsAt: number;
}

export interface ClaudeUsage {
  /** The email of the account these limits belong to (the default account in Settings). */
  account?: string;
  fiveHour?: LimitWindow;
  sevenDay?: LimitWindow;
  /** When Claude Code last reported them. */
  at?: string;
  /** A short Claude request is under way to read them now. */
  refreshing?: boolean;
  /** Learned from AdFlow's own runs: % of the 5-hour limit per USD equivalent (null until there is enough data). */
  pctPerUsd: number | null;
  samples: number;
}

export interface AppInfo extends UpdateState {
  version: string;
  /** False when running from source (npm run dev): the patch number is only set by the release workflow. */
  packaged: boolean;
  electron: string;
  chrome: string;
  node: string;
  /** e.g. "win32 x64" */
  platform: string;
  /** AdFlow's data folder (settings, logs, caches). */
  dataDir: string;
  /** GitHub releases page the updates come from. */
  releasesUrl: string;
}

export interface AdflowApi {
  getSettings(): Promise<Settings>;
  saveSettings(s: Settings): Promise<Settings>;
  setSecret(name: string, value: string): Promise<Record<string, boolean>>;
  secretStatus(): Promise<Record<string, boolean>>;
  secretLabels(): Promise<Record<string, string>>;
  providers(): Promise<ProviderInfo[]>;
  estimate(providerId: string, units: number, model?: string): Promise<string>;
  diagnostics(): Promise<DiagnosticItem[]>;
  playbookSections(): Promise<{ id: string; title: string; found: boolean }[]>;
  playbookConfigOrigin(): Promise<{ origin: 'playbook' | 'preset' | 'empty'; error?: string }>;
  episodeSources(): Promise<EpisodeSourceInfo[]>;
  /** Saves the admin address (and a new token, if given) and checks them; returns who the token belongs to. */
  teamConnect(url: string, token?: string): Promise<{ name: string; email: string }>;
  /** The copy of the team playbook downloaded from the admin. */
  playbookStatus(): Promise<PlaybookSyncStatus>;
  playbookSync(): Promise<PlaybookSyncStatus>;
  /** The folder where new episodes are created. */
  storagePath(): Promise<string>;

  library(): Promise<LibraryItem[]>;
  /** The brief of an episode of the source (what Claude will read), before creating it. */
  sourceBrief(sourceEpisodeId: string): Promise<string>;
  episodes(): Promise<EpisodeState[]>;
  episode(id: string): Promise<EpisodeState>;
  createEpisode(sourceEpisodeId: string): Promise<EpisodeState>;
  patchEpisode(id: string, patch: Partial<Pick<EpisodeState, 'providers' | 'voice' | 'voiceCreditLimit' | 'heygenCreditLimit' | 'closingVoice' | 'videoConfig' | 'brain' | 'feed45'>>): Promise<EpisodeState>;
  act(id: string, action: PipelineAction): Promise<void>;
  activity(id: string): Promise<ActivityEvent[]>;
  queue(): Promise<QueueSnapshot>;

  script(id: string): Promise<{ script: Script | null; guion: string | null; checks: ScriptCheck[]; error?: string }>;
  images(id: string): Promise<ImageItem[]>;
  clips(id: string): Promise<ClipItem[]>;
  /** Real scenes of the script that stay as an image (could become a clip). */
  clipCandidates(id: string): Promise<ClipCandidate[]>;
  narration(id: string): Promise<NarrationLine[]>;
  /** Voices of a provider; refresh re-reads a cached catalog (HeyGen). */
  voices(providerId: string, refresh?: boolean): Promise<VoiceOption[]>;
  previewVoice(id: string, text: string): Promise<{ url?: string; error?: string }>;
  /** Local URL of a voice's recorded sample (ElevenLabs preview_url): free, no credits. */
  /** One voice by its ID (free), for a voice heard on the provider's site. */
  voiceById(providerId: string, voiceId: string): Promise<VoiceOption>;
  voiceSample(voiceId: string, previewUrl: string): Promise<string>;
  adCopy(id: string): Promise<string | null>;
  finalVideo(id: string): Promise<{ file: string; url: string; size: number } | null>;
  /** The 4:5 render for the feeds, when there is one. */
  feedVideo(id: string): Promise<{ file: string; url: string; size: number } | null>;
  /** The versions of the final video already in the team admin (Producción de redes episodes). */
  finalVideoUploads(id: string): Promise<FinalVideoUploads>;
  /** «Subir video final»: uploads the newest render (9:16 and, if there is one, 4:5) as one version; progress arrives as 'videoUpload' events. */
  uploadFinalVideo(id: string): Promise<RemoteVideo[]>;
  renderReport(id: string): Promise<RenderReport | null>;

  openPath(p: string): Promise<void>;
  pickFolder(): Promise<string | null>;
  defaults(cap: Capability): Promise<string>;

  /** The installed version and the update waiting to be installed, if any. */
  appInfo(): Promise<AppInfo>;
  /** Closes AdFlow, installs the downloaded update and opens the new version. */
  restartToUpdate(): Promise<void>;
  /** Looks for a new version now (it is also checked every 30 minutes); progress arrives as 'update' events. */
  checkForUpdates(): Promise<UpdateState>;
  /** Downloads the version found by a check (when automatic updates are off). */
  downloadUpdate(): Promise<UpdateState>;
  /** The Claude account's usage limits, as last reported by Claude Code. */
  claudeUsage(): Promise<ClaudeUsage>;
  /** Reads the limits now with a minimal Claude request (they otherwise update only when AdFlow uses Claude). */
  refreshClaudeUsage(): Promise<ClaudeUsage>;

  on(channel: 'episode', cb: (e: EpisodeState) => void): () => void;
  on(channel: 'activity', cb: (a: ActivityEvent) => void): () => void;
  on(channel: 'queue', cb: (q: QueueSnapshot) => void): () => void;
  on(channel: 'update', cb: (u: UpdateState) => void): () => void;
  on(channel: 'claudeUsage', cb: (u: ClaudeUsage) => void): () => void;
  on(channel: 'videoUpload', cb: (p: VideoUploadProgress) => void): () => void;
}

export const API_METHODS = [
  'getSettings',
  'saveSettings',
  'setSecret',
  'secretStatus',
  'secretLabels',
  'providers',
  'estimate',
  'diagnostics',
  'playbookSections',
  'playbookConfigOrigin',
  'episodeSources',
  'teamConnect',
  'playbookStatus',
  'playbookSync',
  'storagePath',
  'adCopy',
  'finalVideo',
  'feedVideo',
  'finalVideoUploads',
  'uploadFinalVideo',
  'renderReport',
  'library',
  'sourceBrief',
  'episodes',
  'episode',
  'createEpisode',
  'patchEpisode',
  'act',
  'activity',
  'queue',
  'script',
  'images',
  'clips',
  'clipCandidates',
  'narration',
  'voices',
  'previewVoice',
  'voiceById',
  'voiceSample',
  'openPath',
  'pickFolder',
  'defaults',
  'appInfo',
  'restartToUpdate',
  'checkForUpdates',
  'downloadUpdate',
  'claudeUsage',
  'refreshClaudeUsage',
] as const;
