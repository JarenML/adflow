// Episode library: every case of the playbook catalog, pending first. Select several to start a batch.
import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, CircleDashed, Layers, Play, Search, Wand2 } from 'lucide-react';
import type { LibraryItem } from '@shared/types';
import { api, useLive } from '../lib/api';
import { Button, cx, Empty, inputCls, Tag } from '../components/ui';

export function LibraryView({ onOpen }: { onOpen: (id: string) => void }) {
  const [items, reload] = useLive(() => api.library(), []);
  const [tab, setTab] = useState<'pending' | 'produced'>('pending');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const list = items ?? [];
  const shown = useMemo(
    () =>
      list
        .filter((i) => (tab === 'pending' ? !i.produced : i.produced))
        .filter((i) => !query || `${i.title} ${i.businessType} ${i.solution}`.toLowerCase().includes(query.toLowerCase())),
    [list, tab, query],
  );

  const open = async (i: LibraryItem) => {
    const e = await api.createEpisode(i.key);
    reload();
    onOpen(e.id);
  };

  /** Creates the selected episodes and starts their scripts; the queue runs them in parallel. */
  const batch = async () => {
    setBusy(true);
    for (const key of picked) {
      const e = await api.createEpisode(key);
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
          <p className="mt-1 text-[13px] text-mute">Sale del catálogo de casos y del seguimiento del playbook.</p>
        </div>
        {picked.length > 0 && (
          <Button variant="primary" loading={busy} icon={<Layers className="size-4" />} onClick={batch}>
            Generar {picked.length} guion{picked.length > 1 ? 'es' : ''} en lote
          </Button>
        )}
      </div>

      <div className="mb-4 flex items-center gap-3">
        <div className="flex gap-1 rounded-lg border border-line bg-panel p-1 text-[12.5px]">
          {(
            [
              ['pending', `Pendientes (${list.filter((i) => !i.produced).length})`],
              ['produced', `Creados (${list.filter((i) => i.produced).length})`],
            ] as const
          ).map(([id, label]) => (
            <button key={id} className={cx('no-drag rounded-md px-3 py-1.5 font-medium', tab === id ? 'bg-panel-2 text-ink' : 'text-mute hover:text-ink')} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 size-4 text-faint" />
          <input className={cx(inputCls, 'pl-9')} placeholder="Buscar por negocio, solución o título" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>

      {!items ? null : !list.length ? (
        <Empty icon={<CircleDashed className="size-5" />} title="No se pudo leer el playbook" hint="Revisa la carpeta del playbook en Ajustes → Playbook." />
      ) : (
        <div className="space-y-2">
          {shown.map((i, idx) => {
            const sel = picked.includes(i.key);
            return (
              <motion.div
                key={i.key}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(idx * 0.025, 0.3) }}
                className={cx('group grid grid-cols-[28px_64px_1fr_auto] items-center gap-4 rounded-2xl border bg-panel px-4 py-3.5 transition-colors', sel ? 'border-brand/50 bg-brand/5' : 'border-line hover:border-line-2')}
              >
                {!i.produced && !i.episodeId ? (
                  <input
                    type="checkbox"
                    className="no-drag size-4 accent-[#7c5cff]"
                    checked={sel}
                    onChange={() => setPicked((p) => (sel ? p.filter((k) => k !== i.key) : [...p, i.key]))}
                    aria-label={`Elegir ${i.title}`}
                  />
                ) : (
                  <span />
                )}
                <div className="grid size-12 place-items-center rounded-xl bg-panel-2 font-mono text-[13px] font-semibold text-mute">#{i.caseNumber}</div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-[14px] font-semibold">«{i.title}»</p>
                    {i.produced ? (
                      <Tag tone="ok">
                        <CheckCircle2 className="size-3" /> {i.stepLabel?.replace(/^[^\w]*\s*/, '') || 'Producido'}
                      </Tag>
                    ) : i.stepLabel && !/pendiente/i.test(i.stepLabel) ? (
                      <Tag tone="warn">{i.stepLabel}</Tag>
                    ) : null}
                    {i.episodeId && <Tag tone="brand">En AdFlow</Tag>}
                  </div>
                  <p className="text-[12px] text-faint">
                    {i.businessType} · {i.solution}
                  </p>
                  {i.summary && <p className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-mute">{i.summary}</p>}
                </div>
                <Button size="sm" variant={i.episodeId ? 'secondary' : 'ghost'} icon={i.episodeId ? <Play className="size-3.5" /> : <Wand2 className="size-3.5" />} onClick={() => open(i)}>
                  {i.episodeId ? 'Abrir' : 'Crear'}
                </Button>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
