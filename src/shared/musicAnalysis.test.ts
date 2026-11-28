import { describe, expect, it } from 'vitest';
import { analyzeTrack, barStarts, beatGrid, beatsByScene, cutsToAlign, envelopes, estimateTempo, offsetToBeat } from './musicAnalysis';

const SR = 11025;

/** A synthetic track: a short decaying hit on every beat, louder after `loudFrom` seconds. */
function clicks(bpm: number, seconds: number, phase = 0, loudFrom = Infinity): Float32Array {
  const out = new Float32Array(Math.round(SR * seconds));
  const period = 60 / bpm;
  let seed = 7;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let t = phase; t < seconds; t += period) {
    const start = Math.round(t * SR);
    const gain = t >= loudFrom ? 0.9 : 0.3;
    for (let i = 0; i < SR * 0.05 && start + i < out.length; i++) out[start + i] += gain * noise() * Math.exp(-i / (SR * 0.01));
  }
  return out;
}

describe('music analysis', () => {
  it('finds the tempo and where the beats fall', () => {
    const track = clicks(120, 20, 0.1);
    const env = envelopes(track, SR);
    const bpm = estimateTempo(env.onset, env.frameRate, 120);
    expect(bpm).toBeCloseTo(120, 0);
    const beats = beatGrid(env.onset, env.frameRate, bpm);
    expect(Math.abs(offsetToBeat(5.1, beats))).toBeLessThan(0.03);
    // 1.25 s is 0.15 s after the beat at 1.1 s.
    expect(offsetToBeat(1.25, beats)).toBeCloseTo(0.15, 1);
  });

  it('uses the asked tempo to avoid the half-tempo mistake', () => {
    const env = envelopes(clicks(124, 20), SR);
    expect(estimateTempo(env.onset, env.frameRate, 124)).toBeCloseTo(124, 0);
  });

  it('measures the cuts and the drop against the timeline, never moving the fixed scenes', () => {
    const track = clicks(120, 30, 0, 12);
    const a = analyzeTrack(track, SR, { total_s: 30, logo: [6, 8.5], drop_s: 12, final: [24, 30], cortes: [3.15, 6, 8.5, 12, 18.02, 24] }, 120);
    expect(a.bpm).toBeCloseTo(120, 0);
    // The logo, its end, the drop and the closing scene are anchors: not movable.
    expect(a.cuts.filter((c) => !c.movable).map((c) => c.t)).toEqual([6, 8.5, 12, 24]);
    // 3.15 s is off the beat (move it); 18.02 s is already on it.
    expect(cutsToAlign(a).map((c) => c.t)).toEqual([3.15]);
    expect(a.dropRatio).toBeGreaterThan(2);
    expect(a.warnings).toEqual([]);
  });
});

describe('beat grid per scene', () => {
  it('gives each scene its beats from its own start, marks bar starts and skips the fixed templates', () => {
    const track = clicks(120, 30, 0, 12);
    const times = { total_s: 30, logo: [6, 8.5] as [number, number], drop_s: 12, final: [24, 30] as [number, number], cortes: [3, 6, 8.5, 12, 18, 24] };
    const a = analyzeTrack(track, SR, times, 120);
    const bars = barStarts(a, times);
    // Bars every 2 s, in phase with the drop at 12 s.
    expect(bars.some((b) => Math.abs(b - 12) < 0.03)).toBe(true);
    expect(bars.some((b) => Math.abs(b - 13) < 0.03)).toBe(false);
    const grid = beatsByScene(a, times);
    expect(grid).not.toContain('empieza en 6.00'); // the logo
    expect(grid).not.toContain('empieza en 24.00'); // the closing scene
    expect(grid).toContain('empieza en 12.00 s (dura 6.00 s): golpes en +|0.00 +0.4');
  });
});
