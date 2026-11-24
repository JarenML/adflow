import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Limits = typeof import('./claudeLimits');
let L: Limits;
let dir: string;

const RESET = 1_800_000_000; // seconds, as Claude Code reports it
const reading = (fiveHour: number, resetsAt = RESET) => ({
  unifiedWindows: { five_hour: { utilization: fiveHour / 100, resetsAt }, seven_day: { utilization: 0.3, resetsAt: RESET + 86_400 } },
});

/** One AdFlow run: starts, Claude Code reports the limits, ends with its USD equivalent. */
function run(pctAtStart: number, usd: number, resetsAt = RESET) {
  L.runStarted();
  L.limitsReported(reading(pctAtStart, resetsAt));
  L.runEnded(usd);
}

beforeEach(async () => {
  vi.resetModules();
  L = await import('./claudeLimits');
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adflow-limits-'));
  L.initClaudeLimits(dir, () => {});
});

describe('Claude usage limits', () => {
  it('keeps the last reported limits and saves them', () => {
    run(12, 0.5);
    const u = L.claudeUsage();
    expect(u.fiveHour).toEqual({ pct: 12, resetsAt: RESET * 1000 });
    expect(u.sevenDay?.pct).toBeCloseTo(30);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'claude-usage.json'), 'utf8')).fiveHour.pct).toBe(12);
  });

  it('learns % of the 5-hour limit per USD from runs made one at a time', () => {
    run(10, 2); // 2 USD → next reading 14 %
    run(14, 1); // 1 USD → 16 %
    run(16, 3); // 3 USD → 22 %
    run(22, 0);
    const u = L.claudeUsage();
    expect(u.samples).toBe(3);
    expect(u.pctPerUsd).toBeCloseTo(12 / 6); // (4 + 2 + 6) % over (2 + 1 + 3) USD
  });

  it('needs a few samples before estimating', () => {
    run(10, 2);
    run(14, 0);
    expect(L.claudeUsage().pctPerUsd).toBeNull();
  });

  it('ignores stretches with sessions in parallel', () => {
    L.runStarted();
    L.limitsReported(reading(10));
    L.runStarted(); // a second session while the first runs
    L.limitsReported(reading(11));
    L.runEnded(1);
    L.runEnded(1);
    run(15, 0);
    expect(L.claudeUsage().samples).toBe(0);
  });

  it('ignores a stretch where the 5-hour window reset', () => {
    run(80, 2);
    run(3, 0, RESET + 18_000);
    expect(L.claudeUsage().samples).toBe(0);
  });

  it('shows nothing when Claude Code does not report limits', () => {
    L.runStarted();
    L.limitsReported(undefined);
    L.runEnded(1);
    expect(L.claudeUsage().fiveHour).toBeUndefined();
  });
});
