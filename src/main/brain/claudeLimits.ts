// The Claude account's usage limits, as Claude Code reports them at the start of every run
// (stream-json `rate_limit_event`: utilization of the 5-hour and 7-day windows), and an estimate of how
// much of the 5-hour limit one USD equivalent of AdFlow's work takes.
//
// Readings belong to the Claude account that made them (Claude Code's `oauthAccount.accountUuid` in
// `.claude.json`), so signing Claude Code into another account never shows the previous account's
// numbers: the panel shows the default account's last reading, or nothing until it has one.
//
// The limits are per account, so they also move with anything else that uses the same account (the
// person in claude.ai, another computer). The estimate is learned only from stretches where AdFlow ran
// one Claude session at a time, and is the ratio of the sums over the last runs, so a stray use or the
// 1 % rounding of the readings weighs little.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ClaudeUsage, LimitWindow } from '@shared/api';

interface Sample {
  usd: number;
  pct: number;
}
interface AccountReading {
  email?: string;
  fiveHour?: LimitWindow;
  sevenDay?: LimitWindow;
  at?: string;
  samples: Sample[];
}
interface Saved {
  accounts: Record<string, AccountReading>;
}

export interface SignedInAccount {
  id: string;
  email?: string;
}

const MAX_SAMPLES = 40;
const MIN_SAMPLES = 3;
const MIN_USD = 1;

let file = '';
let saved: Saved = { accounts: {} };
let notify: (u: ClaudeUsage) => void = () => {};
/** The config dir of the account the panel shows (AdFlow's default account; undefined = Claude Code's own). */
let shownConfigDir: string | undefined;
let refreshing = false;

/** Claude sessions running right now. */
let active = 0;
/** The last reading, the AdFlow work done since then and whether it was one session at a time. */
let base: (LimitWindow & { account: string }) | null = null;
let usdSince = 0;
let clean = false;

/** The account Claude Code is signed in as for a config dir (no secrets: only its id and email). */
export function signedInAccount(configDir?: string): SignedInAccount | null {
  const f = configDir ? path.join(configDir, '.claude.json') : path.join(os.homedir(), '.claude.json');
  try {
    const a = JSON.parse(fs.readFileSync(f, 'utf8'))?.oauthAccount;
    return typeof a?.accountUuid === 'string' ? { id: a.accountUuid, email: typeof a.emailAddress === 'string' ? a.emailAddress : undefined } : null;
  } catch {
    return null;
  }
}

export function initClaudeLimits(dataDir: string, onChange: (u: ClaudeUsage) => void): void {
  file = path.join(dataDir, 'claude-usage.json');
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    // Files from before readings were per account are dropped: there is no way to know whose they were.
    if (raw && typeof raw.accounts === 'object') saved = { accounts: raw.accounts };
  } catch {
    /* first run */
  }
  notify = onChange;
}

/** Which account the panel shows (the default account's config dir). */
export function showAccount(configDir: string | undefined): void {
  shownConfigDir = configDir || undefined;
}

export function setRefreshing(on: boolean): void {
  refreshing = on;
  notify(claudeUsage());
}

/** Whether the shown account has never been read (e.g. Claude Code was just signed into another one). */
export function needsReading(): SignedInAccount | null {
  const acc = signedInAccount(shownConfigDir);
  return acc && !saved.accounts[acc.id]?.fiveHour ? acc : null;
}

export function claudeUsage(): ClaudeUsage {
  const acc = signedInAccount(shownConfigDir);
  const r: AccountReading = (acc && saved.accounts[acc.id]) || { samples: [] };
  const usd = r.samples.reduce((a, s) => a + s.usd, 0);
  const pct = r.samples.reduce((a, s) => a + s.pct, 0);
  const enough = r.samples.length >= MIN_SAMPLES && usd >= MIN_USD && pct > 0;
  return {
    account: acc?.email ?? r.email,
    fiveHour: r.fiveHour,
    sevenDay: r.sevenDay,
    at: r.at,
    refreshing,
    pctPerUsd: enough ? pct / usd : null,
    samples: r.samples.length,
  };
}

export function runStarted(): void {
  active++;
  if (active > 1) clean = false;
}

export function runEnded(usd: number | undefined): void {
  active = Math.max(0, active - 1);
  usdSince += usd ?? 0;
}

const toWindow = (w: { utilization?: unknown; resetsAt?: unknown } | undefined): LimitWindow | undefined =>
  w && typeof w.utilization === 'number' && typeof w.resetsAt === 'number' ? { pct: w.utilization * 100, resetsAt: w.resetsAt * 1000 } : undefined;

/**
 * A `rate_limit_event` from a run that has just started (so `active` already counts it), made with the
 * given config dir (undefined = Claude Code's own sign-in).
 */
export function limitsReported(
  info: { unifiedWindows?: Record<string, { utilization?: unknown; resetsAt?: unknown }> } | undefined,
  configDir?: string,
): void {
  const fiveHour = toWindow(info?.unifiedWindows?.five_hour);
  if (!fiveHour) return; // not reported by this version of Claude Code: show nothing rather than guess
  const sevenDay = toWindow(info?.unifiedWindows?.seven_day);
  const acc = signedInAccount(configDir || undefined);
  if (!acc) return; // signed in some other way (API key…): no account to file it under
  const prev: AccountReading = saved.accounts[acc.id] ?? { samples: [] };
  let samples = prev.samples;

  // AdFlow's work since the last reading, alone, on the same account and in the same 5-hour window: one sample.
  if (base && clean && active === 1 && usdSince > 0 && base.account === acc.id && base.resetsAt === fiveHour.resetsAt && fiveHour.pct >= base.pct) {
    samples = [...samples, { usd: usdSince, pct: fiveHour.pct - base.pct }].slice(-MAX_SAMPLES);
  }
  base = { ...fiveHour, account: acc.id };
  usdSince = 0;
  clean = active === 1;

  saved = { accounts: { ...saved.accounts, [acc.id]: { email: acc.email, fiveHour, sevenDay, at: new Date().toISOString(), samples } } };
  try {
    if (file) fs.writeFileSync(file, JSON.stringify(saved, null, 2));
  } catch {
    /* keeping it in memory is enough */
  }
  notify(claudeUsage());
}
