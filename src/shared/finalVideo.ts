// «Subir video final»: the final render goes to the team's private bucket through the robles.ai
// admin (Producción de redes), which keeps every version. Pure helpers, testable without the API.

/** A version of the final video as the admin keeps it (SocialVideo in robles.ai). */
export interface RemoteVideo {
  id: number;
  version: number;
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
