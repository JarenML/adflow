// The episode's music, fitted to the final timeline. Claude writes the timeline while it assembles the
// video in Remotion (public/musica/tiempos.json); from it AdFlow builds the composition plan for
// ElevenLabs Music (music_v2_5, which always keeps each section's length): Tension (→ logo) · Logo ·
// Solution (→ drop) · Drop (→ closing scene) · Finale, as the playbook's §4 asks. The logo and the
// closing scene are fixed templates with their own sound: they are the anchors, and the tempo is chosen
// so they and the drop start on a bar. Pure, so it can be tested without the API.

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
  /** Start of every scene after the first (the cuts), to line them up with the beat. */
  cortes?: number[];
}

/** A section of an ElevenLabs Music v2/v2.5 composition plan («chunk»). */
export interface MusicChunk {
  /** Section name in brackets, e.g. «[Tension]» (instrumental: no lyrics). */
  text: string;
  duration_ms: number;
  positive_styles: string[];
  negative_styles: string[];
  context_adherence: 'low' | 'medium' | 'high';
}

export interface MusicPlan {
  chunks: MusicChunk[];
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
  if (Array.isArray(j.cortes)) {
    const cuts = j.cortes.filter((c): c is number => num(c) && c > 0 && c < total).sort((a, b) => a - b);
    if (cuts.length) t.cortes = cuts;
  }
  return t;
}

/** Tempo range the ads use, and the default when there is nothing to line up. */
export const BPM_RANGE: [number, number] = [100, 130];
export const DEFAULT_BPM = 118;

/** The fixed points the music must hit: the logo (in and out), the drop and the closing scene. */
export function musicAnchors(t: MusicTimes): { name: string; t: number }[] {
  const a: { name: string; t: number }[] = [];
  if (t.logo) a.push({ name: 'logo', t: t.logo[0] }, { name: 'fin del logo', t: t.logo[1] });
  if (t.drop_s !== undefined) a.push({ name: 'drop', t: t.drop_s });
  if (t.final) a.push({ name: 'escena final', t: t.final[0] });
  return a.filter((x) => x.t > 0);
}

/**
 * Pure: the whole-number tempo (4/4) at which the anchors land closest to the start of a bar, so the
 * logo, the drop and the closing scene fall on a downbeat. Ties go to the tempo closest to the default.
 */
export function fitBpm(anchors: number[], range: [number, number] = BPM_RANGE): number {
  if (!anchors.length) return DEFAULT_BPM;
  let best = DEFAULT_BPM;
  let bestErr = Infinity;
  for (let bpm = range[0]; bpm <= range[1]; bpm++) {
    const bar = 240 / bpm;
    const err = anchors.reduce((n, a) => {
      const off = a % bar;
      return n + Math.min(off, bar - off) ** 2;
    }, 0);
    if (err < bestErr - 1e-9 || (Math.abs(err - bestErr) <= 1e-9 && Math.abs(bpm - DEFAULT_BPM) < Math.abs(best - DEFAULT_BPM))) {
      best = bpm;
      bestErr = err;
    }
  }
  return best;
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
export function buildMusicPlan(t: MusicTimes): { plan: MusicPlan; totalMs: number; bpm: number } {
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
  const bpm = fitBpm(musicAnchors(t).map((a) => a.t));
  const global = ['instrumental', 'modern corporate tech advertising', 'electronic', 'clean mix', 'social media ad', `${bpm} BPM`, '4/4'];
  const avoid = ['vocals', 'singing', 'lyrics', 'choir', 'spoken word', 'lo-fi', 'distorted guitars'];
  return {
    totalMs,
    bpm,
    plan: {
      chunks: parts.map(({ part, ms }) => ({
        text: `[${part}]`,
        duration_ms: ms,
        positive_styles: [...global, ...STYLE[part].pos],
        negative_styles: [...avoid, ...STYLE[part].neg],
        context_adherence: 'high' as const,
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
