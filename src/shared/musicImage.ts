// The picture of a track that Claude looks at, since it cannot hear: a spectrogram (time → right,
// pitch ↑, brighter = louder) over a loudness strip, with the video's cuts drawn on it. Pure (RGBA
// pixels); src/main/musicAnalyze.ts writes it as PNG.
import { musicAnchors, type MusicTimes } from './music';

export const IMG_W = 1600;
const SPEC_H = 280;
const RMS_H = 80;
export const IMG_H = SPEC_H + RMS_H;
const N = 512; // FFT size: 46 ms at 11 025 Hz

/** In-place radix-2 FFT on real/imaginary arrays of length N (a power of two). */
function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k);
        const wi = Math.sin(ang * k);
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}

/** Dark blue → magenta → yellow, for 0…1. */
function heat(v: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, v));
  if (t < 0.5) {
    const u = t / 0.5;
    return [Math.round(20 + 180 * u), Math.round(10 + 20 * u), Math.round(40 + 120 * u)];
  }
  const u = (t - 0.5) / 0.5;
  return [Math.round(200 + 55 * u), Math.round(30 + 200 * u), Math.round(160 - 120 * u)];
}

/**
 * Pure: the RGBA pixels of the picture. Red lines: the logo and the closing scene (fixed); green: the
 * drop; white: the other cuts; small ticks under the loudness strip: the beats.
 */
export function musicPicture(samples: Float32Array, sampleRate: number, times: MusicTimes, beats: number[] = []): Uint8Array {
  const px = new Uint8Array(IMG_W * IMG_H * 4);
  const total = Math.max(times.total_s, samples.length / sampleRate);
  const set = (x: number, y: number, [r, g, b]: [number, number, number]) => {
    if (x < 0 || y < 0 || x >= IMG_W || y >= IMG_H) return;
    const i = (y * IMG_W + x) * 4;
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    px[i + 3] = 255;
  };
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  const bins = N / 2;
  // Rows map to frequency on a log scale (60 Hz … Nyquist), so bass and voice range are visible.
  const fMin = 60;
  const fMax = sampleRate / 2;
  const rowBin = Array.from({ length: SPEC_H }, (_, y) => {
    const f = fMin * (fMax / fMin) ** (1 - y / (SPEC_H - 1));
    return Math.min(bins - 1, Math.max(1, Math.round((f / fMax) * bins)));
  });
  const columns: Float32Array[] = [];
  const loud: number[] = [];
  let peak = 1e-9;
  for (let x = 0; x < IMG_W; x++) {
    const center = Math.floor(((x + 0.5) / IMG_W) * total * sampleRate);
    let sum = 0;
    for (let k = 0; k < N; k++) {
      const s = samples[center - N / 2 + k] ?? 0;
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / (N - 1));
      re[k] = s * w;
      im[k] = 0;
      sum += s * s;
    }
    loud.push(Math.sqrt(sum / N));
    fft(re, im);
    const col = new Float32Array(bins);
    for (let b = 0; b < bins; b++) {
      col[b] = Math.log10(1e-7 + Math.hypot(re[b], im[b]));
      peak = Math.max(peak, col[b]);
    }
    columns.push(col);
  }
  const floor = peak - 4; // 80 dB of range
  const loudPeak = Math.max(1e-9, ...loud);
  for (let x = 0; x < IMG_W; x++) {
    for (let y = 0; y < SPEC_H; y++) set(x, y, heat((columns[x][rowBin[y]] - floor) / (peak - floor)));
    const h = Math.round((loud[x] / loudPeak) * (RMS_H - 12));
    for (let y = SPEC_H; y < IMG_H; y++) set(x, y, y >= IMG_H - 12 - h && y < IMG_H - 12 ? [90, 200, 255] : [12, 14, 24]);
  }
  const xOf = (t: number) => Math.round((t / total) * (IMG_W - 1));
  for (const b of beats) for (let y = IMG_H - 10; y < IMG_H; y++) set(xOf(b), y, [180, 180, 190]);
  const vline = (t: number, color: [number, number, number]) => {
    const x = xOf(t);
    for (let y = 0; y < IMG_H - 12; y++) for (let d = -1; d <= 1; d++) set(x + d, y, color);
  };
  const fixed = musicAnchors(times);
  for (const c of times.cortes ?? []) if (!fixed.some((f) => Math.abs(f.t - c) < 0.05)) vline(c, [235, 235, 235]);
  for (const a of fixed) vline(a.t, a.name === 'drop' ? [60, 230, 90] : [240, 60, 60]);
  return px;
}

/** Pure: the 16-bit PCM samples of a WAV file (its «data» chunk), as −1…1. */
export function wavSamples(bytes: Uint8Array): Float32Array | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
  if (bytes.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let at = 12;
  while (at + 8 <= bytes.length) {
    const size = view.getUint32(at + 4, true);
    if (tag(at) === 'data') {
      const end = Math.min(bytes.length, at + 8 + size);
      const out = new Float32Array(Math.floor((end - at - 8) / 2));
      for (let i = 0; i < out.length; i++) out[i] = view.getInt16(at + 8 + i * 2, true) / 32768;
      return out;
    }
    at += 8 + size + (size % 2);
  }
  return null;
}
