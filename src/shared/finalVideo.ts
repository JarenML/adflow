// «Subir video final»: the final render goes to the team's private bucket through the robles.ai
// admin (Producción de redes), which keeps every version. Pure helpers, testable without the API.

/** The two formats AdFlow renders: 9:16 (Reels, Stories, TikTok) and 4:5 (feeds). */
export type VideoFormat = '9x16' | '4x5';
export const FORMAT_LABEL: Record<VideoFormat, string> = { '9x16': '9:16', '4x5': '4:5' };

/** A version of the final video as the admin keeps it (SocialVideo in robles.ai). */
export interface RemoteVideo {
  id: number;
  version: number;
  /** Older admins did not send it: those uploads are 9:16. */
  format?: VideoFormat;
  size: number;
  fileName: string | null;
  isCurrent: boolean;
  uploadedBy: string | null;
  createdAt: string;
}

/** What the publish step shows: the versions already uploaded, or why it cannot upload. */
export interface FinalVideoUploads {
  /** false: not an episode of Producción de redes (nothing to upload to). */
  team: boolean;
  /** false: the admin has no bucket set up yet. */
  storage: boolean;
  videos: RemoteVideo[];
  /** Could not ask the admin (no connection, token…). */
  error?: string;
}

/** Progress of an upload, sent as 'videoUpload' events. */
export interface VideoUploadProgress {
  episodeId: string;
  sent: number;
  total: number;
}

const TYPES: Record<string, string> = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm' };

/** Pure: the Content-Type the admin accepts for this file, or null. */
export function videoContentType(file: string): string | null {
  const m = /\.[^.]+$/.exec(file.toLowerCase());
  return (m && TYPES[m[0]]) ?? null;
}

/** Pure: the version already uploaded from this same file (same name and size), if any. */
export function uploadedAs(local: { file: string; size: number }, videos: RemoteVideo[]): RemoteVideo | null {
  return videos.find((v) => v.fileName === local.file && v.size === local.size) ?? null;
}

/** Pure: the formats of each version, newest first (one version = what one upload sent). */
export function versionsOf(videos: RemoteVideo[]): { version: number; isCurrent: boolean; createdAt: string; formats: VideoFormat[] }[] {
  const by = new Map<number, { version: number; isCurrent: boolean; createdAt: string; formats: VideoFormat[] }>();
  for (const v of videos) {
    const row = by.get(v.version) ?? { version: v.version, isCurrent: false, createdAt: v.createdAt, formats: [] };
    row.isCurrent ||= v.isCurrent;
    row.formats.push(v.format ?? '9x16');
    by.set(v.version, row);
  }
  return [...by.values()].sort((a, b) => b.version - a.version);
}

/** Pure: the 4:5 window of a 9:16 frame, the same band the template's «Feed» shows (y 185 of 1920). */
export function feedCrop(width: number, height: number): { w: number; h: number; y: number } {
  const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);
  const h = Math.min(even((width * 5) / 4), even(height));
  const y = Math.min(even((height * 185) / 1920), even(height - h));
  return { w: even(width), h, y };
}
