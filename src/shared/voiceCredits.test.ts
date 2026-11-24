import { describe, expect, it } from 'vitest';
import { heygenCredits, heygenMaxCredits, lineCredits, planHeygenRun, planVoiceRun } from './voiceCredits';

describe('voice credit limit', () => {
  it('one credit per character (eleven_v3)', () => {
    expect(lineCredits('Y vuelven las mismas preguntas.')).toBe(31);
  });

  it('every line fits under a big enough limit', () => {
    expect(planVoiceRun(['a'.repeat(100), 'b'.repeat(50)], 1000)).toEqual({ total: 150, allowed: 150, fits: 2 });
  });

  it('stops at the first line that would pass the limit, never later ones', () => {
    // 100 fits, 80 would make 180 > 150: stops there even though the 20 after it would fit.
    expect(planVoiceRun(['a'.repeat(100), 'b'.repeat(80), 'c'.repeat(20)], 150)).toEqual({ total: 200, allowed: 100, fits: 1 });
  });

  it('a limit exactly at the total lets everything through', () => {
    expect(planVoiceRun(['a'.repeat(60), 'b'.repeat(40)], 100).fits).toBe(2);
  });

  it('HeyGen: 1 premium credit per 1,000 characters', () => {
    expect(heygenCredits(1000)).toBe(1);
    expect(heygenCredits(399)).toBeCloseTo(0.399);
  });

  it('HeyGen limit uses the worst case: ceil(characters / 1,000)', () => {
    expect(heygenMaxCredits(1)).toBe(1);
    expect(heygenMaxCredits(1000)).toBe(1);
    expect(heygenMaxCredits(1001)).toBe(2);
    // 400 + 400 = 800 fits in 1 credit; +400 = 1,200 would need 2: stops before the third line.
    expect(planHeygenRun(['a'.repeat(400), 'b'.repeat(400), 'c'.repeat(400)], 1)).toEqual({ chars: 1200, allowedChars: 800, fits: 2 });
    expect(planHeygenRun(['a'.repeat(400)], 0).fits).toBe(0);
  });

  it('a zero limit sends nothing', () => {
    expect(planVoiceRun(['hola'], 0)).toEqual({ total: 4, allowed: 0, fits: 0 });
  });
});
