// The Claude account's usage limits, as Claude Code reports them at the start of every run
// (stream-json `rate_limit_event`: utilization of the 5-hour and 7-day windows), and an estimate of how
// much of the 5-hour limit one USD equivalent of AdFlow's work takes.
//
// The limits are per account, so they also move with anything else that uses the same account (the
// person in claude.ai, another computer). The estimate is learned only from stretches where AdFlow ran
// one Claude session at a time, and is the ratio of the sums over the last runs, so a stray use or the
// 1 % rounding of the readings weighs little.
import fs from 'node:fs';
import path from 'node:path';
import type { ClaudeUsage, LimitWindow } from '@shared/api';

interface Sample {
  usd: number;
  pct: number;
}
interface Saved {
  fiveHour?: LimitWindow;
  sevenDay?: LimitWindow;
  at?: string;
  samples: Sample[];
}

const MAX_SAMPLES = 40;
const MIN_SAMPLES = 3;
const MIN_USD = 1;

let file = '';
let saved: Saved = { samples: [] };
let notify: (u: ClaudeUsage) => void = () => {};

/** Claude sessions running right now. */
let active = 0;
/** The last reading, the AdFlow work done since then and whether it was one session at a time. */
let base: LimitWindow | null = null;
let usdSince = 0;
let clean = false;

export function initClaudeLimits(dataDir: string, onChange: (u: ClaudeUsage) => void): void {
  file = path.join(dataDir, 'claude-usage.json');
  try {
    saved = { samples: [], ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    /* first run */
  }
  notify = onChange;
}

export function claudeUsage(): ClaudeUsage {
  const usd = saved.samples.reduce((a, s) => a + s.usd, 0);
  const pct = saved.samples.reduce((a, s) => a + s.pct, 0);
  const enough = saved.samples.length >= MIN_SAMPLES && usd >= MIN_USD && pct > 0;
  return {
    fiveHour: saved.fiveHour,
    sevenDay: saved.sevenDay,
    at: saved.at,
    pctPerUsd: enough ? pct / usd : null,
    samples: saved.samples.length,
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

/** A `rate_limit_event` from a run that has just started (so `active` already counts it). */
export function limitsReported(info: { unifiedWindows?: Record<string, { utilization?: unknown; resetsAt?: unknown }> } | undefined): void {
  const fiveHour = toWindow(info?.unifiedWindows?.five_hour);
  if (!fiveHour) return; // not reported by this version of Claude Code: show nothing rather than guess
  const sevenDay = toWindow(info?.unifiedWindows?.seven_day);

  // AdFlow's work since the last reading, alone and in the same 5-hour window: one sample.
  if (base && clean && active === 1 && usdSince > 0 && base.resetsAt === fiveHour.resetsAt && fiveHour.pct >= base.pct) {
    saved.samples = [...saved.samples, { usd: usdSince, pct: fiveHour.pct - base.pct }].slice(-MAX_SAMPLES);
  }
  base = fiveHour;
  usdSince = 0;
  clean = active === 1;

  saved = { ...saved, fiveHour, sevenDay, at: new Date().toISOString() };
  try {
    if (file) fs.writeFileSync(file, JSON.stringify(saved, null, 2));
  } catch {
    /* keeping it in memory is enough */
  }
  notify(claudeUsage());
}
