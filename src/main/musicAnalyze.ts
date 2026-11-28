// AdFlow «listens» to the episode's music: decodes it with Remotion's ffmpeg (to WAV: that build has
// no raw-PCM output and no spectrogram filter), measures it against the timeline
// (shared/musicAnalysis.ts) and draws a picture with the cuts marked (shared/musicImage.ts) that
// Claude can look at. Nothing here needs Python or a GPU.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { runCli } from './proc';
import { analyzeTrack, type MusicAnalysis } from '@shared/musicAnalysis';
import { IMG_H, IMG_W, musicPicture, wavSamples } from '@shared/musicImage';
import type { MusicTimes } from '@shared/music';

const SAMPLE_RATE = 11025;

const ffmpeg = (project: string, args: string[], signal?: AbortSignal) =>
  runCli('npx', ['remotion', 'ffmpeg', '-y', '-loglevel', 'error', ...args], { cwd: project, timeoutMs: 5 * 60_000, signal });

/** Mono samples (−1…1) of an audio file, decoded at 11 025 Hz. */
async function decode(project: string, file: string, tmp: string, signal?: AbortSignal): Promise<Float32Array | null> {
  const r = await ffmpeg(project, ['-i', file, '-ac', '1', '-ar', String(SAMPLE_RATE), '-c:a', 'pcm_s16le', tmp], signal);
  if (r.code !== 0 || !fs.existsSync(tmp)) return null;
  const samples = wavSamples(fs.readFileSync(tmp));
  fs.rmSync(tmp, { force: true });
  return samples;
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** RGBA pixels as a PNG file. */
export function encodePng(rgba: Uint8Array, width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(6, 9); // RGBA
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(rows, y * (width * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

export interface MusicReport {
  analysis: MusicAnalysis;
  /** The picture of the track (null when it could not be written). */
  image: string | null;
}

/**
 * Measures the track in <episode>/musica against the timeline and leaves analisis.json and
 * analisis.png next to it. Null when the audio cannot be read.
 */
export async function analyzeMusic(project: string, musicFile: string, times: MusicTimes, bpmAsked: number | undefined, signal?: AbortSignal): Promise<MusicReport | null> {
  const dir = path.dirname(musicFile);
  const samples = await decode(project, musicFile, path.join(dir, 'analisis-tmp.wav'), signal);
  if (!samples || samples.length < SAMPLE_RATE) return null;
  const analysis = analyzeTrack(samples, SAMPLE_RATE, times, bpmAsked);
  let image: string | null = path.join(dir, 'analisis.png');
  try {
    fs.writeFileSync(image, encodePng(musicPicture(samples, SAMPLE_RATE, times, analysis.beats), IMG_W, IMG_H));
  } catch {
    image = null;
  }
  fs.writeFileSync(path.join(dir, 'analisis.json'), `${JSON.stringify({ track: path.basename(musicFile), sha256: fileHash(musicFile), ...analysis }, null, 2)}\n`);
  return { analysis, image };
}

const fileHash = (file: string) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/**
 * True when analisis.json already describes this exact track (so a re-render does not redo it). By
 * content, not date: «Claude compone» rewrites the same WAV on every render.
 */
export function analyzedAlready(musicFile: string): boolean {
  const file = path.join(path.dirname(musicFile), 'analisis.json');
  if (!fs.existsSync(file) || !fs.existsSync(musicFile)) return false;
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8')) as { track?: string; sha256?: string };
    return j.track === path.basename(musicFile) && j.sha256 === fileHash(musicFile);
  } catch {
    return false;
  }
}
