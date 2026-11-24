// What a narrator run costs in ElevenLabs credits, and how far a credit limit lets it go.
// eleven_v3 (the model AdFlow uses) charges 1 credit per character sent, tags included.

export const ELEVEN_CREDITS_PER_CHAR = 1;

/** Default limit per run when the episode has none: a full ~45 s video is ~400–600 credits. */
export const DEFAULT_VOICE_CREDIT_LIMIT = 1000;

export function lineCredits(text: string): number {
  return Math.ceil(text.length * ELEVEN_CREDITS_PER_CHAR);
}

/**
 * HeyGen Voice: characters add up in a meter shared by every generation, and 1 premium credit is
 * charged each time the meter reaches 1,000 (nothing is charged before that).
 */
export const HEYGEN_CHARS_PER_CREDIT = 1000;

/** Premium credits a text adds to the HeyGen meter (fractions: 400 characters = 0.4 credit). */
export function heygenCredits(chars: number): number {
  return chars / HEYGEN_CHARS_PER_CREDIT;
}

/** Default HeyGen limit per run, in premium credits (a ~400-character narration needs at most 1). */
export const DEFAULT_HEYGEN_CREDIT_LIMIT = 2;

/**
 * The most premium credits some characters can cost on HeyGen. The meter may already be close to
 * 1,000, so N characters can trigger up to ceil(N / 1,000) charges: the limit is checked against this.
 */
export function heygenMaxCredits(chars: number): number {
  return Math.ceil(chars / HEYGEN_CHARS_PER_CREDIT);
}

export interface HeygenPlan {
  /** Characters of all the lines. */
  chars: number;
  /** Characters of the lines that fit under the limit. */
  allowedChars: number;
  /** How many lines fit, in order. */
  fits: number;
}

/** Pure: lines in order while the worst case of their characters stays within the limit. */
export function planHeygenRun(texts: string[], limitCredits: number): HeygenPlan {
  let chars = 0;
  let allowedChars = 0;
  let fits = 0;
  let stopped = false;
  for (const t of texts) {
    chars += t.length;
    if (!stopped && heygenMaxCredits(allowedChars + t.length) <= limitCredits) {
      allowedChars += t.length;
      fits++;
    } else stopped = true;
  }
  return { chars, allowedChars, fits };
}

export interface VoicePlan {
  /** Credits of all the lines. */
  total: number;
  /** Credits of the lines that fit under the limit (in order, stopping at the first that doesn't). */
  allowed: number;
  /** How many lines fit, in order. */
  fits: number;
}

/** Pure: goes line by line and stops at the first one that would pass the limit. */
export function planVoiceRun(texts: string[], limit: number): VoicePlan {
  let allowed = 0;
  let fits = 0;
  let stopped = false;
  let total = 0;
  for (const t of texts) {
    const c = lineCredits(t);
    total += c;
    if (!stopped && allowed + c <= limit) {
      allowed += c;
      fits++;
    } else stopped = true;
  }
  return { total, allowed, fits };
}
