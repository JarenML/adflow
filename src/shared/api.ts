// The bridge between the UI and the main process (exposed by the preload as window.adflow).
import type {
  ActivityEvent,
  Capability,
  ClipItem,
  DiagnosticItem,
  EpisodeState,
  ImageItem,
  LibraryItem,
  NarrationLine,
  PipelineAction,
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

  library(): Promise<LibraryItem[]>;
  episodes(): Promise<EpisodeState[]>;
  episode(id: string): Promise<EpisodeState>;
  createEpisode(libraryKey: string): Promise<EpisodeState>;
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
