// The episode's music, fitted to the final timeline. Claude writes the timeline while it assembles the
// video in Remotion (public/musica/tiempos.json); from it AdFlow builds the composition plan for
// ElevenLabs Music: Tension (→ logo) · Logo · Solution (→ drop) · Drop (→ closing scene) · Finale,
// as the playbook's §4 asks. Pure, so it can be tested without the API.

/** Music providers (the "music" capability of Preparación). */
export const MUSIC_NONE = 'none';
export const MUSIC_ELEVENLABS = 'elevenlabs-music';
export const MUSIC_CLAUDE = 'claude-music';

/** Where Claude writes the timeline (inside the Remotion project) and the file each provider makes. */
export const MUSIC_TIMES_FILE = 'public/musica/tiempos.json';
export const MUSIC_FILE: Record<string, string> = { [MUSIC_ELEVENLABS]: 'musica.mp3', [MUSIC_CLAUDE]: 'musica.wav' };

/** Seconds of the final video. */
export interface MusicTimes {
  total_s: number;
  /** Start and end of the mid-video logo. */
  logo?: [number, number];
  /** First real scene of the "after": where the drop lands. */
  drop_s?: number;
  /** Start and end of the closing scene. */
  final?: [number, number];
}

export interface MusicSection {
  section_name: string;
  duration_ms: number;
  positive_local_styles: string[];
  negative_local_styles: string[];
  lines: string[];
}

export interface MusicPlan {
  positive_global_styles: string[];
  negative_global_styles: string[];
  sections: MusicSection[];
}

/** ElevenLabs Music asks for sections of at least 3 s. */
export const MIN_SECTION_MS = 3000;
/** Rough cost of ElevenLabs Music, in credits per second of track (≈ 200 credits for 50 s). */
export const MUSIC_CREDITS_PER_SECOND = 4;

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const pair = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && num(v[0]) && num(v[1]) && v[1] > v[0];

/** Pure: the timeline Claude wrote, or null when it is missing or makes no sense. Optional parts that are wrong are dropped. */
export function parseMusicTimes(raw: string | null): MusicTimes | null {
  if (!raw) return null;
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!j || typeof j !== 'object' || !num(j.total_s) || j.total_s < MIN_SECTION_MS / 1000) return null;
  const total = j.total_s;
  const t: MusicTimes = { total_s: total };
  if (pair(j.logo) && j.logo[1] <= total) t.logo = j.logo;
  if (num(j.drop_s) && j.drop_s < total) t.drop_s = j.drop_s;
  if (pair(j.final) && j.final[0] < total) t.final = [j.final[0], Math.min(j.final[1], total)];
  return t;
}

const STYLE = {
  Tension: { pos: ['tense', 'low pulsing bass', 'ticking clock percussion', 'suspenseful', 'slowly building', 'ends with a rising swell'], neg: ['happy', 'full drums'] },
  'Logo reveal': { pos: ['big cinematic impact hit at the start', 'airy shimmering pad', 'sparse', 'reveal moment'], neg: ['drums', 'busy'] },
  Solution: { pos: ['optimistic', 'light tech groove', 'plucky synths', 'soft claps', 'building energy', 'curious'], neg: ['dark', 'heavy'] },
  Drop: { pos: ['drop', 'full energy', 'punchy drums', 'bright synth chords', 'uplifting', 'confident'], neg: ['quiet', 'sparse'] },
  Finale: { pos: ['energetic', 'triumphant', 'ends with a hard stop on a single hit'], neg: ['fade out', 'long tail'] },
} as const;
type Part = keyof typeof STYLE;

/**
 * Pure: the composition plan for the timeline. Each part runs until the next mark; a part shorter
 * than 3 s joins the one before it (or the next, if it is the first), so the sections always add up
 * to the video's length.
 */
export function buildMusicPlan(t: MusicTimes): { plan: MusicPlan; totalMs: number } {
  const totalMs = Math.round(t.total_s * 1000);
  const marks: [Part, number][] = [['Tension', 0]];
  if (t.logo) marks.push(['Logo reveal', t.logo[0] * 1000], ['Solution', t.logo[1] * 1000]);
  if (t.drop_s !== undefined) marks.push(['Drop', t.drop_s * 1000]);
  if (t.final) marks.push(['Finale', t.final[0] * 1000]);
  // In time order; a mark at or past the end, or behind the previous one, is ignored.
  const kept: [Part, number][] = [];
  for (const [part, at] of marks.sort((a, b) => a[1] - b[1])) {
    const ms = Math.round(at);
    if (ms >= totalMs || (kept.length && ms <= kept[kept.length - 1][1])) continue;
    kept.push([part, ms]);
  }
  let parts = kept.map(([part, start], i) => ({ part, ms: (i + 1 < kept.length ? kept[i + 1][1] : totalMs) - start }));
  // Join parts shorter than ElevenLabs allows.
  for (let i = 0; i < parts.length && parts.length > 1; ) {
    if (parts[i].ms >= MIN_SECTION_MS) {
      i++;
      continue;
    }
    const into = i === 0 ? 1 : i - 1;
    parts[into] = { ...parts[into], ms: parts[into].ms + parts[i].ms };
    parts = parts.filter((_, k) => k !== i);
    i = 0;
  }
  return {
    totalMs,
    plan: {
      positive_global_styles: ['instrumental', 'modern corporate tech advertising', 'electronic', 'clean mix', '118 bpm', 'social media ad'],
      negative_global_styles: ['vocals', 'singing', 'lyrics', 'choir', 'spoken word', 'lo-fi', 'distorted guitars'],
      sections: parts.map(({ part, ms }) => ({
        section_name: part,
        duration_ms: ms,
        positive_local_styles: [...STYLE[part].pos],
        negative_local_styles: [...STYLE[part].neg],
        lines: [],
      })),
    },
  };
}

/** Pure: same plan ⇒ same key, so a re-render with the same timeline reuses the track (no credits). */
export const musicPlanKey = (plan: MusicPlan) => JSON.stringify(plan);

/**
 * Pure: the track src/audio.tsx plays (MUSIC_FILE), or null. The template keeps only the file name
 * there and prepends musica/ itself; a "musica/…" value is read the same way.
 */
export function audioMusicFile(audio: string): string | null {
  const m = /MUSIC_FILE[^\n=]*=\s*['"`]([^'"`]+)['"`]/.exec(audio);
  return m ? m[1].replace(/^musica\//, '') : null;
}

/** Pure: estimated ElevenLabs credits for a track of this length. */
export const musicCredits = (totalMs: number) => Math.ceil((totalMs / 1000) * MUSIC_CREDITS_PER_SECOND);
