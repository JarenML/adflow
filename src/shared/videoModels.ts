// The Veo models AdFlow can generate clips with (ElevenLabs API and MCP), and the fixed clip length.
import { MAX_CLIP_S } from './schemas';

export interface VideoModel {
  /** Id saved in the episode's videoConfig. */
  id: string;
  /** model_id in ElevenLabs. */
  elevenId: string;
  label: string;
  /**
   * ElevenLabs credits per second of clip. Fast is measured (3,640 per 4 s); Lite and the full model
   * are estimated from Google's price ratio to Fast. The MCP recipe refuses to generate above this
   * price + 15 %, so a wrong estimate fails safe (no credits spent).
   */
  creditsPerSecond: number;
  /** Only the ElevenLabs connector (MCP) offers it; the Image & Video API does not list it. */
  mcpOnly?: boolean;
}

export const VIDEO_MODELS: VideoModel[] = [
  { id: 'veo-3.1-lite', elevenId: 'veo-3.1-lite-generate-001', label: 'Veo 3.1 Lite', creditsPerSecond: 455, mcpOnly: true },
  { id: 'veo-3.1-fast', elevenId: 'veo-3.1-fast-generate-001', label: 'Veo 3.1 Fast', creditsPerSecond: 910 },
  { id: 'veo-3.1', elevenId: 'veo-3.1-generate-001', label: 'Veo 3.1', creditsPerSecond: 2430 },
];

export const DEFAULT_VIDEO_MODEL = 'veo-3.1-fast';

/** Every clip lasts this long: the script keeps clip scenes within it, and Veo's shortest clip is 4 s. */
export const CLIP_S = MAX_CLIP_S;

export function videoModel(id: string | undefined): VideoModel {
  return VIDEO_MODELS.find((m) => m.id === id) ?? VIDEO_MODELS.find((m) => m.id === DEFAULT_VIDEO_MODEL)!;
}

/** The models a video provider can use (Lite only through the MCP). */
export function videoModelsFor(provider: string | undefined): VideoModel[] {
  return VIDEO_MODELS.filter((m) => !m.mcpOnly || provider === 'elevenlabs-mcp');
}

/** The model a provider will really use: the chosen one if it offers it, otherwise the default. */
export function videoModelFor(provider: string | undefined, id: string | undefined): VideoModel {
  const m = videoModel(id);
  return videoModelsFor(provider).includes(m) ? m : videoModel(DEFAULT_VIDEO_MODEL);
}

/** Estimated ElevenLabs credits for one clip of CLIP_S seconds. */
export const clipCredits = (modelId: string | undefined) => Math.round(videoModel(modelId).creditsPerSecond * CLIP_S);
