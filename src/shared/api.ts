// The bridge between the UI and the main process (exposed by the preload as window.adflow).
import type {
  ActivityEvent,
  Capability,
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
  Settings,
  VoiceOption,
} from './types';
import type { Script, ScriptCheck } from './schemas';

export interface AdflowApi {
  getSettings(): Promise<Settings>;
  saveSettings(s: Settings): Promise<Settings>;
  setSecret(name: string, value: string): Promise<Record<string, boolean>>;
  secretStatus(): Promise<Record<string, boolean>>;
  secretLabels(): Promise<Record<string, string>>;
  providers(): Promise<ProviderInfo[]>;
  estimate(providerId: string, units: number): Promise<string>;
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
  episodes(): Promise<EpisodeState[]>;
  episode(id: string): Promise<EpisodeState>;
  createEpisode(sourceEpisodeId: string): Promise<EpisodeState>;
  patchEpisode(id: string, patch: Partial<Pick<EpisodeState, 'providers' | 'voice' | 'closingVoice' | 'videoConfig' | 'brain'>>): Promise<EpisodeState>;
  act(id: string, action: PipelineAction): Promise<void>;
  activity(id: string): Promise<ActivityEvent[]>;
  queue(): Promise<QueueSnapshot>;

  script(id: string): Promise<{ script: Script | null; guion: string | null; checks: ScriptCheck[]; error?: string }>;
  images(id: string): Promise<ImageItem[]>;
  clips(id: string): Promise<ClipItem[]>;
  narration(id: string): Promise<NarrationLine[]>;
  voices(providerId: string): Promise<VoiceOption[]>;
  previewVoice(id: string, text: string): Promise<{ url?: string; error?: string }>;
  adCopy(id: string): Promise<string | null>;
  finalVideo(id: string): Promise<{ file: string; url: string } | null>;

  openPath(p: string): Promise<void>;
  pickFolder(): Promise<string | null>;
  defaults(cap: Capability): Promise<string>;

  on(channel: 'episode', cb: (e: EpisodeState) => void): () => void;
  on(channel: 'activity', cb: (a: ActivityEvent) => void): () => void;
  on(channel: 'queue', cb: (q: QueueSnapshot) => void): () => void;
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
  'library',
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
  'narration',
  'voices',
  'previewVoice',
  'openPath',
  'pickFolder',
  'defaults',
] as const;
