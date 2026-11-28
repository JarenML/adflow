import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchClaudeUsage, toWindow } from './claudeUsageApi';

function configDir(oauth: Record<string, unknown> | null): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adflow-usage-'));
  if (oauth) fs.writeFileSync(path.join(dir, '.credentials.json'), JSON.stringify({ claudeAiOauth: oauth }));
  return dir;
}

afterEach(() => vi.unstubAllGlobals());

describe("Anthropic's usage endpoint", () => {
  it('reads utilization as a percent and the reset time', () => {
    expect(toWindow({ utilization: 57.6, resets_at: '2026-11-29T18:00:00.129810+00:00' })).toEqual({ pct: 57.6, resetsAt: Date.parse('2026-11-29T18:00:00.129Z') });
    expect(toWindow({ utilization: 0, resets_at: null })).toEqual({ pct: 0, resetsAt: 0 });
    expect(toWindow({ resets_at: null })).toBeUndefined();
  });

  it('asks with the sign-in of that config dir', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ five_hour: { utilization: 3, resets_at: '2026-11-28T20:40:00Z' }, seven_day: { utilization: 58, resets_at: '2026-11-29T18:00:00Z' } })));
    vi.stubGlobal('fetch', fetch);
    const r = await fetchClaudeUsage(configDir({ accessToken: 'tok-a', expiresAt: Date.now() + 3_600_000 }));
    expect(r).toEqual({ ok: true, fiveHour: { pct: 3, resetsAt: Date.parse('2026-11-28T20:40:00Z') }, sevenDay: { pct: 58, resetsAt: Date.parse('2026-11-29T18:00:00Z') } });
    const init = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-a');
  });

  it('does not ask with an expired or missing sign-in', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await fetchClaudeUsage(configDir({ accessToken: 'tok', expiresAt: Date.now() - 1 }))).toEqual({ ok: false, reason: 'expired' });
    expect(await fetchClaudeUsage(configDir(null))).toEqual({ ok: false, reason: 'no-sign-in' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports a rejected sign-in so it can be renewed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));
    expect(await fetchClaudeUsage(configDir({ accessToken: 'tok' }))).toEqual({ ok: false, reason: 'unauthorized' });
  });
});
