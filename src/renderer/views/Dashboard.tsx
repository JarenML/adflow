// Jobs: the episodes in AdFlow by team status, plus what is waiting for you.
import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, BellDot, Clapperboard, Cpu, Film, ImageIcon, Library, Mic, Plus } from 'lucide-react';
import type { EpisodeState, QueueSnapshot, TeamStatus } from '@shared/types';
import { TEAM_STATUSES, TEAM_STATUS_LABEL, toTeamStatus } from '@shared/progress';
import { api, useClaudeUsage, useLive, useQueue } from '../lib/api';
import { ClaudeCardLine } from '../components/ClaudeUsage';
import { MiniTimeline } from '../components/Timeline';
import { Button, cx, Empty, formatDate, TeamStatusPill } from '../components/ui';

type Filter = 'all' | 'waiting' | TeamStatus;

/** A step needs the person: waiting for approval or failed. */
function needsYou(e: EpisodeState): boolean {
  return Object.values(e.steps).some((s) => s.status === 'review' || s.status === 'error');
}

function Lanes({ q }: { q?: QueueSnapshot }) {
  if (!q) return null;
  const lanes = [
    ['brain', 'Claude', Cpu],
    ['image', 'Imágenes', ImageIcon],
    ['clip', 'Clips', Film],
    ['voice', 'Voz', Mic],
    ['render', 'Render', Clapperboard],
  ] as const;
  const ep = q.episodes;
  return (
    <div className="space-y-2">
    <p className="text-[12px] text-faint">
      Episodios trabajando: <span className="font-medium text-ink">{ep.active}</span>
      {ep.limit > 0 ? ` de ${ep.limit}` : ' (sin límite)'}
    </p>
    <div className="grid grid-cols-5 gap-3">
      {lanes.map(([id, label, Icon]) => {
        const l = q.lanes[id];
        const max = l.limit === 0 ? 'sin límite' : l.scope === 'episode' ? `máx ${l.limit} por episodio` : `máx ${l.limit} en total`;
        return (
          <div key={id} className="flex items-center gap-3 rounded-xl border border-line bg-panel px-4 py-3">
            <div className={cx('grid size-9 place-items-center rounded-lg', l.running ? 'bg-brand-2/10 text-brand-2' : 'bg-panel-2 text-faint')}>
              <Icon className={cx('size-[18px]', l.running > 0 && 'animate-pulse')} />
            </div>
            <div>
              <p className="text-[13px] font-semibold">{label}</p>
              <p className="text-[11.5px] text-faint">
                {l.running} en curso · {l.waiting} en cola
              </p>
              <p className="text-[11px] text-faint/80">{max}</p>
            </div>
          </div>
        );
      })}
    </div>
    </div>
  );
}

export function Dashboard({ onOpen, onCreate }: { onOpen: (id: string) => void; onCreate: () => void }) {
  const [episodes] = useLive(() => api.episodes(), []);
  const q = useQueue();
  const claudeUsage = useClaudeUsage();
  const [filter, setFilter] = useState<Filter>('all');
  const list = episodes ?? [];
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: list.length, waiting: list.filter(needsYou).length };
    for (const s of TEAM_STATUSES) c[s] = list.filter((e) => toTeamStatus(e).status === s).length;
    return c;
  }, [list]);
  // Most recent first: the date on each card (last activity) decides the order.
  const shown = list
    .filter((e) => filter === 'all' || (filter === 'waiting' ? needsYou(e) : toTeamStatus(e).status === filter))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

  const filters: [Filter, string][] = [['all', 'Todos'], ...TEAM_STATUSES.map((s) => [s, TEAM_STATUS_LABEL[s]] as [Filter, string])];

  return (
    <div className="mx-auto max-w-[1180px] px-8 py-8">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Jobs</h1>
          <p className="mt-1 text-[13px] text-mute">Episodios en producción. Se procesan en paralelo y cada paso requiere tu aprobación.</p>
        </div>
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={onCreate}>
          Crear
        </Button>
      </div>

      <Lanes q={q} />

      <div className="mt-6 mb-4 flex flex-wrap items-center gap-1.5">
        {filters.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setFilter(id)}
            className={cx('no-drag rounded-full border px-3 py-1 text-[12.5px] font-medium transition-colors', filter === id ? 'border-line-2 bg-panel-2 text-ink' : 'border-line text-mute hover:text-ink')}
          >
            {label} <span className="ml-1 text-faint">{counts[id] ?? 0}</span>
          </button>
        ))}
        <button
          onClick={() => setFilter('waiting')}
          className={cx(
            'no-drag ml-auto flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12.5px] font-medium transition-colors',
            filter === 'waiting' ? 'border-warn/50 bg-warn/10 text-warn' : counts.waiting ? 'border-warn/30 text-warn hover:bg-warn/5' : 'border-line text-faint',
          )}
        >
          <BellDot className="size-3.5" /> Pendientes de revisión <span className="ml-0.5">{counts.waiting}</span>
        </button>
      </div>

      {!list.length ? (
        <Empty
          icon={<Library className="size-5" />}
          title="Aún no hay episodios en producción"
          hint="Inicia uno desde Crear."
          action={
            <Button variant="primary" icon={<ArrowRight className="size-4" />} onClick={onCreate}>
              Ir a Crear
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-2">
          {shown.map((e, i) => {
            return (
              <motion.button
                key={e.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                onClick={() => onOpen(e.id)}
                className="no-drag group flex items-center gap-5 rounded-2xl border border-line bg-panel px-4 py-3 text-left transition-colors hover:border-line-2 hover:bg-[#10131a]"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold">{e.title}</p>
                  <p className="truncate text-[12px] text-faint">
                    {e.businessType}
                    <span className="ml-2">
                      <ClaudeCardLine episode={e} usage={claudeUsage} />
                    </span>
                  </p>
                </div>
                <div className="shrink-0">
                  <MiniTimeline episode={e} />
                </div>
                <span className="w-32 shrink-0 text-right text-[11px] text-faint">{formatDate(e.updatedAt)}</span>
                <div className="flex w-56 shrink-0 justify-end">
                  <TeamStatusPill progress={toTeamStatus(e)} />
                </div>
              </motion.button>
            );
          })}
        </div>
      )}
    </div>
  );
}
