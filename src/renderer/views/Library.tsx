// Episode library: every episode of the active source, grouped by the four team statuses.
// Select several pending ones to create them and write their scripts in one batch.
import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { CircleDashed, Layers, Play, Search, Wand2 } from 'lucide-react';
import type { LibraryItem, TeamStatus } from '@shared/types';
import { TEAM_STATUSES, TEAM_STATUS_LABEL } from '@shared/progress';
import { api, useLive } from '../lib/api';
import { Button, cx, Empty, inputCls, Tag, TeamStatusPill } from '../components/ui';

const TAB_LABEL: Record<TeamStatus, string> = {
  pendiente: 'Pendientes',
  en_produccion: 'En producción',
  terminado: 'Terminados',
  publicado: 'Publicados',
};

export function LibraryView({ onOpen }: { onOpen: (id: string) => void }) {
  const [items, reload] = useLive(() => api.library(), []);
  const [tab, setTab] = useState<TeamStatus>('pendiente');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const list = items ?? [];
  const counts = useMemo(() => Object.fromEntries(TEAM_STATUSES.map((s) => [s, list.filter((i) => i.status === s).length])) as Record<TeamStatus, number>, [list]);
  const shown = useMemo(
    () =>
      list
        .filter((i) => i.status === tab)
        .filter((i) => !query || `${i.title} ${i.businessType} ${i.solution} ${i.summary}`.toLowerCase().includes(query.toLowerCase())),
    [list, tab, query],
  );

  const open = async (i: LibraryItem) => {
    const e = await api.createEpisode(i.id);
    reload();
    onOpen(e.id);
  };

  /** Creates the selected episodes and starts their scripts; the queue runs them in parallel. */
  const batch = async () => {
    setBusy(true);
    for (const id of picked) {
      const e = await api.createEpisode(id);
      if (e.steps.prep.status !== 'approved') await api.act(e.id, { step: 'prep', type: 'approve' });
      if (e.steps.script.status !== 'review' && e.steps.script.status !== 'approved') await api.act(e.id, { step: 'script', type: 'generate' });
    }
    setPicked([]);
    setBusy(false);
    reload();
  };

  return (
    <div className="mx-auto max-w-[1180px] px-8 py-8">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Biblioteca de episodios</h1>
          <p className="mt-1 text-[13px] text-mute">Todos los episodios de la fuente elegida en Ajustes, por estado.</p>
        </div>
        {picked.length > 0 && (
          <Button variant="primary" loading={busy} icon={<Layers className="size-4" />} onClick={batch}>
            Generar {picked.length} guion{picked.length > 1 ? 'es' : ''} en lote
          </Button>
        )}
      </div>

      <div className="mb-4 flex items-center gap-3">
        <div className="flex gap-1 rounded-lg border border-line bg-panel p-1 text-[12.5px]">
          {TEAM_STATUSES.map((s) => (
            <button key={s} className={cx('no-drag whitespace-nowrap rounded-md px-3 py-1.5 font-medium', tab === s ? 'bg-panel-2 text-ink' : 'text-mute hover:text-ink')} onClick={() => setTab(s)}>
              {TAB_LABEL[s]} <span className="ml-0.5 text-faint">{counts[s] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 size-4 text-faint" />
          <input className={cx(inputCls, 'pl-9')} placeholder="Buscar por negocio, solución o título" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>

      {!items ? null : !list.length ? (
        <Empty icon={<CircleDashed className="size-5" />} title="La fuente no tiene episodios" hint="Revisa la fuente de episodios y la carpeta del playbook en Ajustes." />
      ) : !shown.length ? (
        <Empty icon={<CircleDashed className="size-5" />} title={`Ningún episodio ${TEAM_STATUS_LABEL[tab].toLowerCase()}`} />
      ) : (
        <div className="space-y-2">
          {shown.map((i, idx) => {
            const sel = picked.includes(i.id);
            const selectable = i.status === 'pendiente' && !i.episodeId;
            return (
              <motion.div
                key={i.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(idx * 0.025, 0.3) }}
                className={cx('grid grid-cols-[28px_56px_1fr_auto] items-center gap-4 rounded-2xl border bg-panel px-4 py-3.5 transition-colors', sel ? 'border-brand/50 bg-brand/5' : 'border-line hover:border-line-2')}
              >
                {selectable ? (
                  <input
                    type="checkbox"
                    className="no-drag size-4 accent-[#7c5cff]"
                    checked={sel}
                    onChange={() => setPicked((p) => (sel ? p.filter((k) => k !== i.id) : [...p, i.id]))}
                    aria-label={`Elegir ${i.title}`}
                  />
                ) : (
                  <span />
                )}
                <div className="grid size-12 place-items-center rounded-xl bg-panel-2 font-mono text-[13px] font-semibold text-mute">{i.caseNumber ? `#${i.caseNumber}` : '—'}</div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-[14px] font-semibold">«{i.title}»</p>
                    <TeamStatusPill progress={i.progress} status={i.status} extra={!i.progress && i.status === 'en_produccion' ? i.stepLabel : undefined} />
                    {i.assignee && <Tag>{i.assignee}</Tag>}
                    {i.publication && <Tag tone="ok">{[i.publication.network, i.publication.date].filter(Boolean).join(' · ')}</Tag>}
                  </div>
                  <p className="text-[12px] text-faint">
                    {i.businessType} · {i.solution}
                  </p>
                  {i.summary && <p className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-mute">{i.summary}</p>}
                </div>
                <Button size="sm" variant={i.episodeId ? 'secondary' : 'ghost'} icon={i.episodeId ? <Play className="size-3.5" /> : <Wand2 className="size-3.5" />} onClick={() => open(i)}>
                  {i.episodeId ? 'Abrir' : i.status === 'pendiente' ? 'Crear' : 'Traer a AdFlow'}
                </Button>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
