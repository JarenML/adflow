// Which text each voice take says. The audio of a line is `voces/<id>.wav|mp3`, matched by the
// line's number, not its text: if the script changes (or a narrator line is added or removed and the
// numbers shift), the file still exists but says something else. Every new take is recorded in
// `voces/textos.json` ({ "n08": "the text it says" }) and a line whose text no longer matches is
// treated as having no audio until it is generated again, so an old take never reaches the render.
// Takes made before this record existed have no entry and are trusted as they are.

export const TAKES_FILE = 'textos.json';

export type TakeRecord = Record<string, string>;

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Pure: true when a line has audio whose recorded text is not the script's text anymore. */
export function isStale(text: string, hasFile: boolean, recorded: string | undefined): boolean {
  return hasFile && recorded !== undefined && norm(recorded) !== norm(text);
}

/** Pure: a line still needs a take (no audio, or audio of another text). */
export const needsTake = (l: { file?: string; stale?: boolean }) => !l.file || !!l.stale;

/** Pure: reads the record, ignoring a damaged file or values that are not text. */
export function parseTakes(raw: string | null): TakeRecord {
  if (!raw) return {};
  try {
    const j = JSON.parse(raw) as unknown;
    if (!j || typeof j !== 'object' || Array.isArray(j)) return {};
    return Object.fromEntries(Object.entries(j).filter(([, v]) => typeof v === 'string')) as TakeRecord;
  } catch {
    return {};
  }
}
