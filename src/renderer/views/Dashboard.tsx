// Production board: every episode in progress, filtered by who has to act next.
import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Clapperboard, Cpu, ImageIcon, Library, Plus } from 'lucide-react';
import type { EpisodeState, QueueSnapshot } from '@shared/types';
import { STEPS } from '@shared/types';
import { api, useLive, useQueue } from '../lib/api';
import { MiniTimeline } from '../components/Timeline';
import { Button, cx, Empty, formatDate, StatusPill } from '../components/ui';

type Filter = 'all' | 'waiting' | 'working' | 'done' | 'idle';

function bucket(e: EpisodeState): Exclude<Filter, 'all'> {
  const sts = Object.values(e.steps).map((s) => s.status);
  if (sts.includes('working')) return 'working';
  if (e.steps.render.status === 'approved') return 'done';
  if (sts.includes('review') || sts.includes('error')) return 'waiting';
  return 'idle';
}

function Lanes({ q }: { q?: QueueSnapshot }) {
  if (!q) return null;
  const lanes = [
    ['brain', 'Claude', Cpu],
    ['image', 'Imágenes', ImageIcon],
    ['render', 'Voz y render', Clapperboard],
  ] as const;
  return (
    <div className="grid grid-cols-3 gap-3">
      {lanes.map(([id, label, Icon]) => {
        const l = q.lanes[id];
        return (
          <div key={id} className="flex items-center gap-3 rounded-xl border border-line bg-panel px-4 py-3">
            <div className={cx('grid size-9 place-items-center rounded-lg', l.running ? 'bg-brand-2/10 text-brand-2' : 'bg-panel-2 text-faint')}>
              <Icon className={cx('size-[18px]', l.running > 0 && 'animate-pulse')} />
            </div>
            <div>
              <p className="text-[13px] font-semibold">{label}</p>
              <p className="text-[11.5px] text-faint">
                {l.running}/{l.limit} en curso · {l.waiting} en cola
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function Dashboard({ onOpen, onLibrary }: { onOpen: (id: string) => void; onLibrary: () => void }) {
  const [episodes] = useLive(() => api.episodes(), []);
  const q = useQueue();
  const [filter, setFilter] = useState<Filter>('all');
  const list = episodes ?? [];
  const counts = useMemo(() => {
    const c = { all: list.length, waiting: 0, working: 0, done: 0, idle: 0 };
    list.forEach((e) => c[bucket(e)]++);
    return c;
  }, [list]);
  const shown = list.filter((e) => filter === 'all' || bucket(e) === filter);

  const filters: [Filter, string][] = [
    ['all', 'Todos'],
    ['waiting', 'Esperando por ti'],
    ['working', 'Trabajando'],
    ['done', 'Terminados'],
    ['idle', 'Inactivos'],
  ];

  return (
    <div className="mx-auto max-w-[1180px] px-8 py-8">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Producción</h1>
          <p className="mt-1 text-[13px] text-mute">Varios episodios avanzan a la vez. Tú apruebas cada paso.</p>
        </div>
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={onLibrary}>
          Nuevo episodio
        </Button>
      </div>

      <Lanes q={q} />

      <div className="mt-6 mb-4 flex flex-wrap gap-1.5">
        {filters.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setFilter(id)}
            className={cx('no-drag rounded-full border px-3 py-1 text-[12.5px] font-medium transition-colors', filter === id ? 'border-line-2 bg-panel-2 text-ink' : 'border-line text-mute hover:text-ink')}
          >
            {label} <span className="ml-1 text-faint">{counts[id]}</span>
          </button>
        ))}
      </div>

      {!list.length ? (
        <Empty
          icon={<Library className="size-5" />}
          title="Aún no hay episodios en producción"
          hint="Elige uno o varios episodios pendientes en la biblioteca para empezar."
          action={
            <Button variant="primary" icon={<ArrowRight className="size-4" />} onClick={onLibrary}>
              Ir a la biblioteca
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {shown.map((e, i) => {
            const cur = STEPS.find((s) => s.id === e.current)!;
            return (
              <motion.button
                key={e.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                onClick={() => onOpen(e.id)}
                className="no-drag group rounded-2xl border border-line bg-panel p-4 text-left transition-colors hover:border-line-2 hover:bg-[#10131a]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-semibold">{e.title}</p>
                    <p className="truncate text-[12px] text-faint">{e.businessType}</p>
                  </div>
                  <StatusPill status={e.steps[e.current].status} label={cur.label} />
                </div>
                <div className="mt-4 flex items-center justify-between">
                  <MiniTimeline episode={e} />
                  <span className="text-[11px] text-faint">{formatDate(e.updatedAt)}</span>
                </div>
              </motion.button>
            );
          })}
        </div>
      )}
    </div>
  );
}
