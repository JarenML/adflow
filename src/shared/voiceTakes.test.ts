import { describe, expect, it } from 'vitest';
import { isStale, needsTake, parseTakes } from './voiceTakes';

describe('voice takes', () => {
  it('marks a take whose text changed in the script', () => {
    expect(isStale('Robly la prepara.', true, 'Robly deja la cita lista.')).toBe(true);
    expect(isStale('Robly la prepara.', true, '  Robly  la prepara. ')).toBe(false);
    // No audio, or an older take with no record: nothing to compare.
    expect(isStale('Robly la prepara.', false, 'Otra cosa')).toBe(false);
    expect(isStale('Robly la prepara.', true, undefined)).toBe(false);
  });

  it('a changed line needs a new take like a line without audio', () => {
    expect(needsTake({ file: 'n01.wav' })).toBe(false);
    expect(needsTake({ file: 'n01.wav', stale: true })).toBe(true);
    expect(needsTake({})).toBe(true);
  });

  it('reads the record and survives a damaged file', () => {
    expect(parseTakes('{"n01":"Hola","n02":3}')).toEqual({ n01: 'Hola' });
    expect(parseTakes('no es json')).toEqual({});
    expect(parseTakes('[1]')).toEqual({});
    expect(parseTakes(null)).toEqual({});
  });
});
