import { describe, expect, it } from 'vitest';
import { audioMusicFile, buildMusicPlan, musicCredits, musicPlanKey, parseMusicTimes } from './music';

const sections = (raw: string) => buildMusicPlan(parseMusicTimes(raw)!).plan.sections.map((s) => [s.section_name, s.duration_ms]);

describe('music', () => {
  it('follows the timeline: tension, logo, solution, drop and finale', () => {
    const raw = JSON.stringify({ total_s: 47.5, logo: [15.5, 18], drop_s: 32, final: [41.14, 47.5] });
    const plan = buildMusicPlan(parseMusicTimes(raw)!);
    // The logo (2.5 s) is under 3 s, so it joins the part before it.
    expect(plan.plan.sections.map((s) => s.section_name)).toEqual(['Tension', 'Solution', 'Drop', 'Finale']);
    expect(plan.plan.sections.map((s) => s.duration_ms)).toEqual([18000, 14000, 9140, 6360]);
    expect(plan.plan.sections.reduce((n, s) => n + s.duration_ms, 0)).toBe(plan.totalMs);
    expect(plan.plan.negative_global_styles).toContain('vocals');
  });

  it('keeps a logo of 3 s or more as its own section', () => {
    expect(sections(JSON.stringify({ total_s: 50, logo: [15, 18], drop_s: 32, final: [44, 50] }))).toEqual([
      ['Tension', 15000],
      ['Logo reveal', 3000],
      ['Solution', 14000],
      ['Drop', 12000],
      ['Finale', 6000],
    ]);
  });

  it('works with only the total, and ignores marks that make no sense', () => {
    expect(sections(JSON.stringify({ total_s: 30 }))).toEqual([['Tension', 30000]]);
    expect(sections(JSON.stringify({ total_s: 30, drop_s: 40, logo: [20, 10] }))).toEqual([['Tension', 30000]]);
    // A tiny first part joins the next one.
    expect(sections(JSON.stringify({ total_s: 30, drop_s: 1 }))).toEqual([['Drop', 30000]]);
  });

  it('rejects a missing or broken timeline', () => {
    expect(parseMusicTimes(null)).toBeNull();
    expect(parseMusicTimes('nope')).toBeNull();
    expect(parseMusicTimes('{"total_s": 1}')).toBeNull();
    expect(parseMusicTimes('{"logo": [1, 2]}')).toBeNull();
  });

  it('reads which track audio.tsx plays', () => {
    expect(audioMusicFile("export const MUSIC_FILE: string | null = 'musica.mp3';")).toBe('musica.mp3');
    expect(audioMusicFile('export const MUSIC_FILE = "musica/musica.wav";')).toBe('musica.wav');
    // The template as it comes: no track, and the later uses of MUSIC_FILE are not a value.
    expect(audioMusicFile('export const MUSIC_FILE: string | null = null;\nif (!MUSIC_FILE) return null;\n<Audio src={staticFile(`musica/${MUSIC_FILE}`)} />')).toBeNull();
  });

  it('reuses the track only for the same plan, and estimates its credits', () => {
    const a = buildMusicPlan({ total_s: 40, drop_s: 20 }).plan;
    expect(musicPlanKey(a)).toBe(musicPlanKey(buildMusicPlan({ total_s: 40, drop_s: 20 }).plan));
    expect(musicPlanKey(a)).not.toBe(musicPlanKey(buildMusicPlan({ total_s: 41, drop_s: 20 }).plan));
    expect(musicCredits(50_000)).toBe(200);
  });
});
