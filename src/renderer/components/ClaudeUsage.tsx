// How much of Claude an episode used, and the account's usage limits.
// Costs are the USD equivalent Claude Code reports (covered by the subscription, not charged);
// the % of the 5-hour limit is an estimate learned from AdFlow's own runs (see main/brain/claudeLimits.ts).
import { useState } from 'react';
import { Gauge, RefreshCw } from 'lucide-react';
import type { ClaudeUsage, LimitWindow } from '@shared/api';
import type { CostEntry, EpisodeState, StepId } from '@shared/types';
import { STEPS } from '@shared/types';
import { api } from '../lib/api';
import { cx } from './ui';

export interface ClaudeTotals {
  runs: number;
  usd: number;
  tokens: number | null;
  durationMs: number | null;
}

const isClaude = (c: CostEntry) => c.provider === 'claude-cli' && typeof c.usd === 'number';

function totals(entries: CostEntry[]): ClaudeTotals {
  const withTokens = entries.filter((c) => c.tokens);
  const withTime = entries.filter((c) => c.durationMs);
  return {
    runs: entries.length,
    usd: entries.reduce((a, c) => a + (c.usd ?? 0), 0),
    tokens: withTokens.length ? withTokens.reduce((a, c) => a + c.tokens!.input + c.tokens!.output + c.tokens!.cacheRead + c.tokens!.cacheWrite, 0) : null,
    durationMs: withTime.length ? withTime.reduce((a, c) => a + (c.durationMs ?? 0), 0) : null,
  };
}

export function episodeClaude(e: EpisodeState): { total: ClaudeTotals; bySteps: { step: StepId; label: string; t: ClaudeTotals }[] } {
  const claude = e.costs.filter(isClaude);
  return {
    total: totals(claude),
    bySteps: STEPS.map((s) => ({ step: s.id, label: s.label, t: totals(claude.filter((c) => c.step === s.id)) })).filter((r) => r.t.runs > 0),
  };
}

const usd = (n: number) => `USD ${n.toFixed(2)}`;
const pct = (n: number) => (n < 1 ? '< 1 %' : `${Math.round(n)} %`);
const tokens = (n: number | null) => (n === null ? '—' : n >= 1e6 ? `${(n / 1e6).toFixed(1)} M` : n >= 1e3 ? `${Math.round(n / 1e3)} k` : String(n));
const minutes = (ms: number | null) => (ms === null ? '—' : ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`);
const clock = (ms: number) => new Date(ms).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const day = (ms: number) => new Date(ms).toLocaleDateString('es-PE', { weekday: 'short', day: 'numeric' });

/** «≈ 18 % del límite de 5 h», once AdFlow has learned the conversion for this account. */
export function estimatePct(usdAmount: number, u?: ClaudeUsage): number | null {
  return u?.pctPerUsd ? usdAmount * u.pctPerUsd : null;
}

/** One line for an episode card: «Claude ≈ 18 % de 5 h · USD 10.39». */
export function ClaudeCardLine({ episode, usage }: { episode: EpisodeState; usage?: ClaudeUsage }) {
  const { total } = episodeClaude(episode);
  if (!total.runs) return null;
  const est = estimatePct(total.usd, usage);
  return (
    <span className="text-[11px] text-faint" title="Uso de Claude en este episodio (equivalente en USD; incluido en tu suscripción)">
      Claude {est !== null && <>≈ {pct(est)} de 5 h · </>}
      {usd(total.usd)}
    </span>
  );
}

function Bar({ label, w, sub, hint }: { label: string; w: LimitWindow; sub: string; hint: string }) {
  const high = w.pct >= 80;
  return (
    <div title={hint}>
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="truncate text-mute">{label}</span>
        <span className={cx('shrink-0 whitespace-nowrap font-mono', high ? 'text-warn' : 'text-ink')}>{Math.round(w.pct)} %</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line">
        <div className={cx('h-full rounded-full', high ? 'bg-warn' : 'bg-brand')} style={{ width: `${Math.min(100, Math.max(2, w.pct))}%` }} />
      </div>
      <p className="mt-1 text-[10.5px] text-faint">{sub}</p>
    </div>
  );
}

/** The default account's 5-hour and weekly limits, as Claude Code last reported them. */
export function LimitBars({ usage }: { usage?: ClaudeUsage }) {
  if (!usage?.fiveHour && !usage?.refreshing) return null;
  const { fiveHour, sevenDay, refreshing } = usage;
  const expired = fiveHour && fiveHour.resetsAt < Date.now();
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 text-[10.5px] text-faint">
        <span className="truncate" title={usage.account ? `Cuenta de Claude: ${usage.account}` : undefined}>
          {usage.account ?? 'Cuenta de Claude'}
        </span>
        <button
          onClick={() => void api.refreshClaudeUsage()}
          disabled={refreshing}
          className="no-drag flex shrink-0 items-center gap-1 rounded px-1 transition-colors hover:text-ink disabled:cursor-default disabled:hover:text-faint"
          title="Consultar ahora el uso de esta cuenta (hace una solicitud mínima a Claude)"
        >
          <RefreshCw className={cx('size-3', refreshing && 'animate-spin')} />
          {refreshing ? 'Consultando' : usage.at ? clock(Date.parse(usage.at)) : ''}
        </button>
      </div>
      {fiveHour && (
        <Bar
          label="Claude · 5 h"
          w={expired ? { ...fiveHour, pct: 0 } : fiveHour}
          sub={expired ? 'Restablecido' : `Se restablece a las ${clock(fiveHour.resetsAt)}`}
          hint="Uso del límite de 5 horas de tu cuenta de Claude, incluido el uso fuera de AdFlow. Se actualiza con cada solicitud de AdFlow o con el botón de actualizar."
        />
      )}
      {sevenDay && (
        <Bar
          label="Claude · semana"
          w={sevenDay.resetsAt < Date.now() ? { ...sevenDay, pct: 0 } : sevenDay}
          sub={sevenDay.resetsAt < Date.now() ? 'Restablecido' : `Se restablece el ${day(sevenDay.resetsAt)}`}
          hint="Uso del límite semanal de tu cuenta de Claude."
        />
      )}
    </div>
  );
}

/** Header chip of an episode with the Claude usage per step. */
export function EpisodeClaudeUsage({ episode, usage }: { episode: EpisodeState; usage?: ClaudeUsage }) {
  const [open, setOpen] = useState(false);
  const { total, bySteps } = episodeClaude(episode);
  if (!total.runs) return null;
  const est = estimatePct(total.usd, usage);
  return (
    <div className="no-drag relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12px] text-mute transition-colors hover:border-line-2 hover:text-ink"
        aria-expanded={open}
      >
        <Gauge className="size-3.5" />
        Claude {est !== null ? `≈ ${pct(est)} de 5 h` : usd(total.usd)}
      </button>
      {open && (
        <>
          <button className="fixed inset-0 z-20 cursor-default" aria-label="Cerrar" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-30 mt-2 w-[480px] rounded-xl border border-line-2 bg-panel p-4 shadow-2xl">
            <p className="text-[13px] font-semibold text-ink">Uso de Claude en este episodio</p>
            <table className="mt-3 w-full text-[12px]">
              <thead>
                <tr className="text-left text-[11px] text-faint">
                  <th className="pb-1.5 font-medium">Paso</th>
                  <th className="pb-1.5 text-right font-medium">Sesiones</th>
                  <th className="pb-1.5 text-right font-medium">Tokens</th>
                  <th className="pb-1.5 text-right font-medium">Tiempo</th>
                  <th className="pb-1.5 text-right font-medium">USD equiv.</th>
                  {usage?.pctPerUsd && <th className="pb-1.5 text-right font-medium">≈ 5 h</th>}
                </tr>
              </thead>
              <tbody className="font-mono text-ink">
                {[...bySteps, { step: 'total', label: 'Total', t: total }].map((r) => (
                  <tr key={r.step} className={cx('border-t border-line', r.step === 'total' && 'font-semibold')}>
                    <td className="py-1.5 font-sans">{r.label}</td>
                    <td className="py-1.5 text-right">{r.t.runs}</td>
                    <td className="py-1.5 text-right">{tokens(r.t.tokens)}</td>
                    <td className="py-1.5 text-right">{minutes(r.t.durationMs)}</td>
                    <td className="py-1.5 text-right">{r.t.usd.toFixed(2)}</td>
                    {usage?.pctPerUsd && <td className="py-1.5 text-right">{pct(r.t.usd * usage.pctPerUsd)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-[11px] leading-relaxed text-mute">
              USD equivalentes: lo que costaría por la API. Con tu suscripción no se cobra; sirve para comparar.{' '}
              {usage?.pctPerUsd
                ? `El % del límite de 5 h es una estimación basada en ${usage.samples} sesiones de esta cuenta.`
                : 'El % del límite de 5 h estará disponible tras algunas sesiones.'}{' '}
              Tokens y tiempo registrados desde la versión 0.1.4.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
