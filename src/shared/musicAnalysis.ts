// How AdFlow «listens» to a generated track so Claude (which cannot hear) can line the cuts up with it:
// an onset envelope from the samples, the tempo and beat grid it implies, and how far each cut and
// anchor lands from the nearest beat, plus whether the drop really hits. Pure, tested with synthetic
// tracks; the samples come from ffmpeg (src/main/musicAnalyze.ts).
import { musicAnchors, type MusicTimes } from './music';

/** Frames per second of the envelopes (hop of ~11.6 ms at 11 025 Hz). */
const HOP = 128;

export interface Envelopes {
  /** Positive change of log energy per frame: high where a hit starts. */
  onset: Float32Array;
  /** Loudness per frame (RMS). */
  rms: Float32Array;
  frameRate: number;
}

/** Pure: onset and loudness envelopes of mono samples (−1…1). */
export function envelopes(samples: Float32Array, sampleRate: number, hop = HOP): Envelopes {
  const n = Math.floor(samples.length / hop);
  const rms = new Float32Array(n);
  const onset = new Float32Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = i * hop; j < (i + 1) * hop; j++) sum += samples[j] * samples[j];
    rms[i] = Math.sqrt(sum / hop);
    const loud = Math.log10(1e-6 + rms[i]);
    onset[i] = i ? Math.max(0, loud - prev) : 0;
    prev = loud;
  }
  return { onset, rms, frameRate: sampleRate / hop };
}

/**
 * Pure: the tempo (BPM) of the onset envelope, by autocorrelation between 70 and 180 BPM. A hint
 * (the tempo that was asked for) breaks the usual half/double-tempo ambiguity.
 */
export function estimateTempo(onset: Float32Array, frameRate: number, hint?: number): number {
  const score = (bpm: number) => {
    const lag = (60 / bpm) * frameRate;
    const l0 = Math.floor(lag);
    const f = lag - l0;
    let s = 0;
    for (let i = 0; i + l0 + 1 < onset.length; i++) s += onset[i] * (onset[i + l0] * (1 - f) + onset[i + l0 + 1] * f);
    return s;
  };
  let best = 120;
  let bestScore = -Infinity;
  for (let bpm = 70; bpm <= 180; bpm += 0.5) {
    const s = score(bpm);
    if (s > bestScore) {
      bestScore = s;
      best = bpm;
    }
  }
  if (hint) {
    // Prefer the multiple of the found tempo closest to what was asked, if it scores nearly as well.
    const options = [best / 2, best, best * 2].filter((b) => b >= 60 && b <= 200);
    const near = options.reduce((a, b) => (Math.abs(b - hint) < Math.abs(a - hint) ? b : a));
    if (near !== best && score(near) >= 0.6 * bestScore) best = near;
  }
  // Fine tuning: a 1 BPM error drifts the grid ~0.4 s over a 50 s ad, so the tempo is refined to
  // 0.05 BPM by how well a whole beat grid lands on the onsets.
  let fine = best;
  let fineScore = -Infinity;
  for (let bpm = best - 2; bpm <= best + 2 + 1e-9; bpm += 0.05) {
    const s = gridFit(onset, frameRate, bpm).score;
    if (s > fineScore) {
      fineScore = s;
      fine = bpm;
    }
  }
  return Math.round(fine * 100) / 100;
}

/** Pure: how well a beat grid of this tempo lands on the onsets, at its best phase. */
function gridFit(onset: Float32Array, frameRate: number, bpm: number): { score: number; phase: number } {
  const period = (60 / bpm) * frameRate;
  const steps = 64;
  let phase = 0;
  let score = -Infinity;
  for (let k = 0; k < steps; k++) {
    const p = (k / steps) * period;
    let s = 0;
    for (let t = p; t < onset.length; t += period) {
      const i = Math.round(t);
      // A beat counts the strongest onset within ±2 frames (≈ ±23 ms).
      let m = 0;
      for (let d = -2; d <= 2; d++) m = Math.max(m, onset[i + d] ?? 0);
      s += m;
    }
    if (s > score) {
      score = s;
      phase = p;
    }
  }
  return { score, phase };
}

/** Pure: the beats (seconds) of a tempo, with the phase that best matches the onsets. */
export function beatGrid(onset: Float32Array, frameRate: number, bpm: number): number[] {
  const period = (60 / bpm) * frameRate;
  const { phase } = gridFit(onset, frameRate, bpm);
  const beats: number[] = [];
  for (let t = phase; t < onset.length; t += period) beats.push(t / frameRate);
  return beats;
}

/** Pure: signed distance (s) from t to the nearest beat (negative: the beat comes after t). */
export function offsetToBeat(t: number, beats: number[]): number {
  let best = Infinity;
  for (const b of beats) if (Math.abs(t - b) < Math.abs(best)) best = t - b;
  return Number.isFinite(best) ? best : 0;
}

function meanRms(env: Envelopes, from: number, to: number): number {
  const a = Math.max(0, Math.floor(from * env.frameRate));
  const b = Math.min(env.rms.length, Math.ceil(to * env.frameRate));
  if (b <= a) return 0;
  let s = 0;
  for (let i = a; i < b; i++) s += env.rms[i];
  return s / (b - a);
}

export interface MusicAnalysis {
  bpm: number;
  /** The tempo that was asked for (ElevenLabs), when known. */
  bpmAsked?: number;
  beatS: number;
  /** Where the beats fall (s). */
  beats: number[];
  anchors: { name: string; t: number; offset: number }[];
  /** Cuts between scenes; `movable` is false at the logo and the closing scene (fixed templates). */
  cuts: { t: number; offset: number; movable: boolean }[];
  /** Loudness 2 s after the drop / 2 s before it (≥ 1.3: the drop is heard). */
  dropRatio: number | null;
  warnings: string[];
}

/** Beyond this a cut is moved to the beat (s). */
export const CUT_TOLERANCE_S = 0.08;
/** Beyond this an anchor (logo, drop, closing scene) is reported as off the beat (s). */
export const ANCHOR_TOLERANCE_S = 0.15;
/** Most a cut may move to reach the beat (s): half a beat at 100 BPM, so any cut can reach one. */
export const MAX_CUT_SHIFT_S = 0.31;

/** «el logo», «la escena final»… for the warnings. */
const ARTICLE: Record<string, string> = { logo: 'El logo', 'fin del logo': 'El fin del logo', drop: 'El drop', 'escena final': 'La escena final' };

/** Pure: everything AdFlow measures in a track against the video's timeline. */
export function analyzeTrack(samples: Float32Array, sampleRate: number, times: MusicTimes, bpmAsked?: number): MusicAnalysis {
  const env = envelopes(samples, sampleRate);
  const bpm = estimateTempo(env.onset, env.frameRate, bpmAsked);
  const beats = beatGrid(env.onset, env.frameRate, bpm);
  const round = (n: number) => Math.round(n * 1000) / 1000;
  const fixed = musicAnchors(times).map((a) => a.t);
  const anchors = musicAnchors(times).map((a) => ({ ...a, offset: round(offsetToBeat(a.t, beats)) }));
  const cuts = (times.cortes ?? []).map((t) => ({
    t,
    offset: round(offsetToBeat(t, beats)),
    movable: !fixed.some((f) => Math.abs(f - t) < 0.05),
  }));
  const dropRatio = times.drop_s !== undefined ? round(meanRms(env, times.drop_s, times.drop_s + 2) / Math.max(1e-6, meanRms(env, times.drop_s - 2, times.drop_s))) : null;

  const warnings: string[] = [];
  if (bpmAsked && Math.abs(bpm - bpmAsked) > 3) warnings.push(`La pista va a ${bpm} BPM y se pidió ${bpmAsked}.`);
  for (const a of anchors) if (Math.abs(a.offset) > ANCHOR_TOLERANCE_S) warnings.push(`${ARTICLE[a.name] ?? a.name} (${a.t.toFixed(2)} s) cae a ${Math.abs(a.offset).toFixed(2)} s del golpe más cercano.`);
  if (dropRatio !== null && dropRatio < 1.3) warnings.push(`El drop casi no se nota: la música sube solo ×${dropRatio.toFixed(2)} al entrar la escena del «después».`);
  return { bpm, bpmAsked, beatS: round(60 / bpm), beats: beats.map(round), anchors, cuts, dropRatio, warnings };
}

/** Pure: the cuts Claude should move to the beat (movable, off by more than the tolerance, reachable). */
export const cutsToAlign = (a: MusicAnalysis) => a.cuts.filter((c) => c.movable && Math.abs(c.offset) > CUT_TOLERANCE_S && Math.abs(c.offset) <= MAX_CUT_SHIFT_S);

/**
 * Pure: the bar starts (every 4th beat), in phase with the drop (or the logo): the tempo was chosen so
 * the anchors start a bar, so the big visual moments go there.
 */
export function barStarts(a: MusicAnalysis, times: MusicTimes): number[] {
  const anchor = times.drop_s ?? times.logo?.[0];
  if (!a.beats.length) return [];
  if (anchor === undefined) return a.beats.filter((_, i) => i % 4 === 0);
  let k = 0;
  for (let i = 1; i < a.beats.length; i++) if (Math.abs(a.beats[i] - anchor) < Math.abs(a.beats[k] - anchor)) k = i;
  return a.beats.filter((_, i) => (i - k) % 4 === 0);
}

/**
 * Pure: the beat grid of each scene, in seconds from the scene's start (what Claude needs to time the
 * camera moves, clicks, pop-ins and 2D transitions inside it). Bar starts are marked with «|».
 */
export function beatsByScene(a: MusicAnalysis, times: MusicTimes): string {
  const starts = [0, ...(times.cortes ?? [])].filter((t, i, all) => all.indexOf(t) === i).sort((x, y) => x - y);
  const bars = barStarts(a, times);
  const isBar = (b: number) => bars.some((x) => Math.abs(x - b) < 0.01);
  const fixed = musicAnchors(times);
  const lines: string[] = [];
  starts.forEach((start, i) => {
    const end = starts[i + 1] ?? times.total_s;
    const name = fixed.find((f) => Math.abs(f.t - start) < 0.05)?.name;
    if (name === 'logo' || name === 'escena final') return; // fixed templates: nothing to retime
    const inside = a.beats.filter((b) => b >= start - 0.01 && b < end - 0.05).map((b) => `${isBar(b) ? '|' : ''}${Math.max(0, b - start).toFixed(2)}`);
    lines.push(`- escena que empieza en ${start.toFixed(2)} s (dura ${(end - start).toFixed(2)} s): golpes en +${inside.join(' +')}`);
  });
  return lines.join('\n');
}

/** Pure: the analysis in a few lines, for the activity log and Claude's prompt. */
export function describeAnalysis(a: MusicAnalysis): string {
  const lines = [`Tempo medido: ${a.bpm} BPM${a.bpmAsked ? ` (pedido ${a.bpmAsked})` : ''}, un golpe cada ${a.beatS.toFixed(3)} s.`];
  for (const x of a.anchors) lines.push(`- ${x.name} en ${x.t.toFixed(2)} s: ${Math.abs(x.offset) <= ANCHOR_TOLERANCE_S ? 'en el golpe' : `${x.offset > 0 ? '+' : ''}${x.offset.toFixed(2)} s del golpe`} (fijo).`);
  for (const c of a.cuts.filter((c) => c.movable)) lines.push(`- corte en ${c.t.toFixed(2)} s: ${Math.abs(c.offset) <= CUT_TOLERANCE_S ? 'en el golpe' : `${c.offset > 0 ? '+' : ''}${c.offset.toFixed(2)} s del golpe → ${(c.t - c.offset).toFixed(2)} s`}.`);
  if (a.dropRatio !== null) lines.push(`- drop: la música sube ×${a.dropRatio.toFixed(2)} al entrar la escena del «después».`);
  return lines.join('\n');
}
