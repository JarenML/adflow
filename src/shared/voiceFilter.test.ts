import { describe, expect, it } from 'vitest';
import { languageOptions, matchesVoice, voiceIdFromQuery, voiceLanguage } from './voiceFilter';

const voices = [
  { name: 'Diana - Voice for Reels & Ads', language: 'es', gender: 'female' },
  { name: 'Eduardo - Mexican Spanish', language: 'es', gender: 'male' },
  { name: 'Roger - Laid-Back', language: 'en', gender: 'male' },
  { name: 'Sarah - Mature', language: 'american', gender: 'female' },
  { name: 'Lulu - Playful', language: 'es', gender: 'neutral' },
  { name: 'Marie', language: 'fr', gender: 'female' },
];
const names = (lang: string, gender: 'all' | 'female' | 'male') => voices.filter((v) => matchesVoice(v, lang, gender)).map((v) => v.name.split(' ')[0]);

describe('voice filters: language and gender combine', () => {
  it('reads the language from the label or the accent', () => {
    expect(voiceLanguage(voices[3])).toBe('en');
    expect(voiceLanguage(voices[5])).toBe('fr');
  });

  it('Spanish + female, Spanish + male, English + female', () => {
    expect(names('es', 'female')).toEqual(['Diana']);
    expect(names('es', 'male')).toEqual(['Eduardo']);
    expect(names('en', 'female')).toEqual(['Sarah']);
  });

  it('"all" in one group keeps the other filter', () => {
    expect(names('es', 'all')).toEqual(['Diana', 'Eduardo', 'Lulu']);
    expect(names('all', 'male')).toEqual(['Eduardo', 'Roger']);
    expect(names('all', 'all')).toHaveLength(6);
  });

  it('language options: Spanish and English first, with counts', () => {
    expect(languageOptions(voices).map((o) => `${o.code}:${o.count}`)).toEqual(['es:3', 'en:2', 'fr:1']);
  });

  it('finds a voice by its ID', () => {
    const fina = { id: '9e607155c11f45e98a311bbe8e4176ec', name: 'Fina - Polished', language: 'es' };
    expect(matchesVoice(fina, 'all', 'all', '9e607155c11f45e98a311bbe8e4176ec')).toBe(true);
    expect(matchesVoice(fina, 'all', 'all', ' 9e607155 ')).toBe(true);
  });

  it('recognizes a pasted voice ID, never a normal search or unsafe text', () => {
    expect(voiceIdFromQuery(' 9e607155c11f45e98a311bbe8e4176ec ')).toBe('9e607155c11f45e98a311bbe8e4176ec');
    expect(voiceIdFromQuery('JBFqnCBsd6RMkjVDRZzb')).toBe('JBFqnCBsd6RMkjVDRZzb');
    expect(voiceIdFromQuery('Fina')).toBeNull();
    expect(voiceIdFromQuery('femenina española')).toBeNull();
    expect(voiceIdFromQuery('abcdefghijklmnopqrst')).toBeNull();
    expect(voiceIdFromQuery('9e607155c11f45e9; rm -rf')).toBeNull();
  });
});
