// ElevenLabs through its API with the person's key: narrator voice (text to speech, eleven_v3) and
// clips (Image & Video API, Veo 3.1 with the scene image as first frame). Both spend credits, so the
// pipeline only calls them when paid providers are allowed in Settings.
import fs from 'node:fs';
import path from 'node:path';
import { videoModel } from '@shared/videoModels';

const API = 'https://api.elevenlabs.io';

async function fail(res: Response, what: string): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as { detail?: unknown };
  const detail = typeof body.detail === 'string' ? body.detail : body.detail ? JSON.stringify(body.detail) : '';
  const hint =
    res.status === 401
      ? ' (revisa la clave de API)'
      : res.status === 402
        ? what.includes('música')
          ? ' (sin créditos suficientes o el plan no incluye música)'
          : ' (la API de imagen y video necesita plan Pro o superior)'
        : res.status === 403 && what.includes('música')
          ? ' (la clave necesita el permiso music_generation)'
          : '';
  throw new Error(`ElevenLabs no pudo ${what}: ${res.status}${hint}${detail ? ` · ${detail.slice(0, 300)}` : ''}`);
}

/** One narrator line. Keeps the [emotion] tags: eleven_v3 performs them. */
export async function elevenSpeech(key: string, voiceId: string, text: string, outFile: string): Promise<string> {
  const out = outFile.replace(/\.\w+$/, '.mp3');
  const res = await fetch(`${API}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, model_id: 'eleven_v3' }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) await fail(res, 'generar la voz');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  return out;
}

/**
 * An instrumental track from a composition plan (ElevenLabs Music, music_v1), saved as MP3. Its
 * sections follow the video's timeline (shared/music.ts). Takes about a minute.
 */
export async function elevenMusic(key: string, plan: unknown, outFile: string, signal?: AbortSignal): Promise<string> {
  const timeout = AbortSignal.timeout(300_000);
  const res = await fetch(`${API}/v1/music?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ composition_plan: plan, model_id: 'music_v1' }),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!res.ok) await fail(res, 'generar la música');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, Buffer.from(await res.arrayBuffer()));
  return outFile;
}

/**
 * Credits the account has used this period (character_count of the subscription), or null when the
 * key may not read it. Read before and after a run to log what it really spent.
 */
export async function elevenUsedCredits(key: string): Promise<number | null> {
  try {
    const res = await fetch(`${API}/v1/user/subscription`, { headers: { 'xi-api-key': key }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const s = (await res.json()) as { character_count?: number };
    return typeof s.character_count === 'number' ? s.character_count : null;
  } catch {
    return null;
  }
}

export interface ClipJob {
  key: string;
  /** First frame (the scene image). */
  image: string;
  prompt: string;
  model: string;
  durationS: number;
  resolution: '720p' | '1080p';
  audio: boolean;
  outFile: string;
  signal?: AbortSignal;
  onStatus?: (status: string) => void;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new Error('Cancelado'));
    });
  });

/** Starts a clip, waits for it (polling every 10 s, at most 15 min) and saves the MP4. */
export async function elevenClip(job: ClipJob): Promise<string> {
  const mime = /\.jpe?g$/i.test(job.image) ? 'image/jpeg' : /\.webp$/i.test(job.image) ? 'image/webp' : 'image/png';
  const duration = [4, 6, 8].find((d) => d >= job.durationS) ?? 8;
  const headers = { 'xi-api-key': job.key, 'Content-Type': 'application/json' };
  const created = await fetch(`${API}/v1/flows/video`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model_id: videoModel(job.model).elevenId,
      prompt: job.prompt,
      start_frame: { type: 'inline_base64', content_base64: fs.readFileSync(job.image).toString('base64'), mime_type: mime },
      aspect_ratio: '9:16',
      duration_secs: duration,
      resolution: job.resolution,
      generate_audio: job.audio,
    }),
    signal: job.signal,
  });
  if (!created.ok) await fail(created, 'empezar el clip');
  const { id } = (await created.json()) as { id: string };

  const deadline = Date.now() + 15 * 60_000;
  let wait = 10_000;
  while (Date.now() < deadline) {
    await sleep(wait, job.signal);
    const res = await fetch(`${API}/v1/flows/video/${encodeURIComponent(id)}`, { headers: { 'xi-api-key': job.key }, signal: job.signal });
    if (res.status === 429) {
      wait = Math.min(wait * 2, 60_000);
      continue;
    }
    if (!res.ok) await fail(res, 'leer el estado del clip');
    const g = (await res.json()) as { status: string; content_url?: string; failure_reason?: string; error_message?: string };
    job.onStatus?.(g.status);
    if (g.status === 'failed') throw new Error(`ElevenLabs no generó el clip (${g.failure_reason ?? 'error'}): ${g.error_message ?? ''}`.trim());
    if (g.status === 'completed' && g.content_url) {
      const video = await fetch(g.content_url, { signal: job.signal });
      if (!video.ok) throw new Error(`No se pudo descargar el clip (${video.status}).`);
      fs.mkdirSync(path.dirname(job.outFile), { recursive: true });
      fs.writeFileSync(job.outFile, Buffer.from(await video.arrayBuffer()));
      return job.outFile;
    }
  }
  throw new Error('El clip tardó más de 15 minutos. Vuelve a intentarlo o súbelo manualmente.');
}
