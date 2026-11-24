// Voice list filters: language and gender are two independent groups that combine
// (e.g. Spanish + female). Pure, so the voice step and its tests share it.

export interface FilterableVoice {
  id?: string;
  name: string;
  language: string;
  gender?: string;
}

export type GenderFilter = 'all' | 'female' | 'male';

const LANG_LABELS: Record<string, string> = {
  es: 'Español',
  en: 'Inglés',
  pt: 'Portugués',
  fr: 'Francés',
  it: 'Italiano',
  de: 'Alemán',
  ja: 'Japonés',
  zh: 'Chino',
  ko: 'Coreano',
  hi: 'Hindi',
  ar: 'Árabe',
  ru: 'Ruso',
  nl: 'Neerlandés',
  pl: 'Polaco',
  tr: 'Turco',
};

/** The language of a voice as a short code (es, en…), from its label, accent or name. */
export function voiceLanguage(v: FilterableVoice): string {
  const text = `${v.language} ${v.name}`.toLowerCase();
  if (/^es\b|spanish|español|latin|mexic|argentin|colombia|peru|chile|castil/.test(text)) return 'es';
  if (/^en\b|english|american|british|australian|irish|scottish/.test(text)) return 'en';
  const code = v.language.trim().toLowerCase().slice(0, 2);
  return /^[a-z]{2}$/.test(code) ? code : '';
}

export function languageLabel(code: string): string {
  return LANG_LABELS[code] ?? code.toUpperCase();
}

/** Languages present in the list, Spanish and English first, then by how many voices they have. */
export function languageOptions(voices: FilterableVoice[]): { code: string; label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const v of voices) {
    const c = voiceLanguage(v);
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const rank = (c: string) => (c === 'es' ? 0 : c === 'en' ? 1 : 2);
  return [...counts.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]) || b[1] - a[1])
    .map(([code, count]) => ({ code, label: languageLabel(code), count }));
}

export function matchesVoice(v: FilterableVoice, lang: string, gender: GenderFilter, query = ''): boolean {
  if (lang !== 'all' && voiceLanguage(v) !== lang) return false;
  if (gender !== 'all' && (v.gender ?? '').toLowerCase() !== gender) return false;
  const q = query.trim().toLowerCase();
  return !q || `${v.id ?? ''} ${v.name} ${v.language} ${languageLabel(voiceLanguage(v))} ${v.gender ?? ''}`.toLowerCase().includes(q);
}

/**
 * A pasted voice ID (HeyGen: 32 hex characters; ElevenLabs: 20 letters and digits). Only letters
 * and digits, so it is safe to hand to the provider; null when the text is a normal search.
 */
export function voiceIdFromQuery(query: string): string | null {
  const q = query.trim();
  return /^[A-Za-z0-9]{16,40}$/.test(q) && /\d/.test(q) ? q : null;
}
