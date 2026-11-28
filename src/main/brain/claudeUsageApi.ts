// The account's usage limits straight from Anthropic: the same endpoint claude.ai's usage page and
// Claude Code's /usage read, so the numbers match them exactly. The `rate_limit_event` Claude Code
// emits during a run carries the same utilization cut to two decimals (57.6 % arrives as 0.57), which
// made AdFlow show about 1 % less.
//
// It is called with the sign-in Claude Code already keeps for that config dir (`.credentials.json`).
// The token is read only to make this one request to api.anthropic.com: AdFlow never stores, logs or
// sends it anywhere else. Reading the limits this way costs no usage.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { LimitWindow } from '@shared/api';

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

export type UsageFetch =
  | { ok: true; fiveHour: LimitWindow; sevenDay?: LimitWindow }
  /** expired / unauthorized: a Claude Code run renews the sign-in. */
  | { ok: false; reason: 'no-sign-in' | 'expired' | 'unauthorized' | 'error' };

/** Claude Code's sign-in for a config dir (undefined = its own default, ~/.claude). */
function signIn(configDir?: string): { token: string; expiresAt?: number } | null {
  const f = path.join(configDir || path.join(os.homedir(), '.claude'), '.credentials.json');
  try {
    const o = JSON.parse(fs.readFileSync(f, 'utf8'))?.claudeAiOauth;
    if (typeof o?.accessToken !== 'string' || !o.accessToken) return null;
    return { token: o.accessToken, expiresAt: typeof o.expiresAt === 'number' && o.expiresAt > 0 ? o.expiresAt : undefined };
  } catch {
    return null;
  }
}

/** `{ utilization: 57.6, resets_at: ISO | null }` → a LimitWindow (no reset time yet = nothing used: 0 %, already reset). */
export function toWindow(w: unknown): LimitWindow | undefined {
  const x = w as { utilization?: unknown; resets_at?: unknown } | null | undefined;
  if (!x || typeof x.utilization !== 'number') return undefined;
  const resetsAt = typeof x.resets_at === 'string' ? Date.parse(x.resets_at) : NaN;
  return { pct: x.utilization, resetsAt: Number.isFinite(resetsAt) ? resetsAt : 0 };
}

export async function fetchClaudeUsage(configDir?: string): Promise<UsageFetch> {
  const s = signIn(configDir);
  if (!s) return { ok: false, reason: 'no-sign-in' };
  if (s.expiresAt && s.expiresAt < Date.now() + 30_000) return { ok: false, reason: 'expired' };
  try {
    const res = await fetch(USAGE_URL, {
      headers: { Authorization: `Bearer ${s.token}`, 'anthropic-beta': 'oauth-2025-04-20' },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 401 || res.status === 403) return { ok: false, reason: 'unauthorized' };
    if (!res.ok) return { ok: false, reason: 'error' };
    const j = (await res.json()) as Record<string, unknown>;
    const fiveHour = toWindow(j?.five_hour);
    if (!fiveHour) return { ok: false, reason: 'error' };
    return { ok: true, fiveHour, sevenDay: toWindow(j?.seven_day) };
  } catch {
    return { ok: false, reason: 'error' };
  }
}
