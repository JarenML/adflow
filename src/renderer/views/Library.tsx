// Episode library: every episode of the active source, grouped by the four team statuses.
// Select several pending ones to create them and write their scripts in one batch.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { CircleDashed, Layers, Play, RefreshCw, Search, Wand2 } from 'lucide-react';
import type { LibraryItem, TeamStatus } from '@shared/types';
import { TEAM_STATUSES, TEAM_STATUS_LABEL } from '@shared/progress';
import { api } from '../lib/api';
import { Button, cx, Empty, inputCls, Tag, TeamStatusPill } from '../components/ui';

/** Groups spellings of the same business type ("Clínicas…" / "clinicas…  "). */
function businessKey(b?: string): string {
  return (b ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const TAB_LABEL: Record<TeamStatus, string> = {
  pendiente: 'Pendientes',
  en_produccion: 'En producción',
  terminado: 'Terminados',
  publicado: 'Publicados',
};

export function LibraryView({ onOpen }: { onOpen: (id: string) => void }) {
  const [items, setItems] = useState<LibraryItem[]>();
  const [loadError, setLoadError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  /** Loads the library from the episode source (the admin may be slow or unreachable). */
  const reload = useCallback(async () => {
    setRefreshing(true);
    try {
      setItems(await api.library());
      setLoadError('');
    } catch (err) {
      setLoadError(String((err as Error)?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
      setItems((prev) => prev ?? []);
    } finally {
      setRefreshing(false);
    }
  }, []);
  // On open, and every time the window gets focus again (changes made in the admin show up).
  useEffect(() => {
    void reload();
    const onFocus = () => void reload();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [reload]);
  const [tab, setTab] = useState<TeamStatus>('pendiente');
  const [query, setQuery] = useState('');
  /** Normalized business type to filter by ('' = all). */
  const [business, setBusiness] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [me, setMe] = useState<string>();
  useEffect(() => {
    api.getSettings().then((s) => setMe(s.episodeSource === 'produccion-redes' ? s.team?.userName : undefined));
  }, []);
  const takenByOther = (i: LibraryItem) => !i.episodeId && !!i.assignee && !!me && i.assignee !== me;
  const clean = (err: unknown) => String((err as Error)?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  const list = items ?? [];
  /** Business types present in the current tab (with how many episodes each), A→Z. */
  const businesses = useMemo(() => {
    const byKey = new Map<string, { label: string; count: number }>();
    for (const i of list) {
      if (i.status !== tab) continue;
      const key = businessKey(i.businessType);
      if (!key) continue;
      const b = byKey.get(key);
      if (b) b.count++;
      else byKey.set(key, { label: i.businessType.trim(), count: 1 });
    }
    return [...byKey.entries()].map(([key, b]) => ({ key, ...b })).sort((a, b) => a.label.localeCompare(b.label, 'es'));
  }, [list, tab]);
  const inBusiness = useCallback((i: LibraryItem) => !business || businessKey(i.businessType) === business, [business]);
  const counts = useMemo(
    () => Object.fromEntries(TEAM_STATUSES.map((s) => [s, list.filter((i) => i.status === s && inBusiness(i)).length])) as Record<TeamStatus, number>,
    [list, inBusiness],
  );
  const shown = useMemo(
    () =>
      list
        .filter((i) => i.status === tab && inBusiness(i))
        .filter((i) => !query || `${i.title} ${i.businessType} ${i.solution} ${i.summary}`.toLowerCase().includes(query.toLowerCase())),
    [list, tab, query, inBusiness],
  );

  const open = async (i: LibraryItem) => {
    setError('');
    try {
      const e = await api.createEpisode(i.id);
      reload();
      onOpen(e.id);
    } catch (err) {
      setError(clean(err));
      reload();
    }
  };

  /** Creates the selected episodes and starts their scripts; the queue runs them in parallel. */
  const batch = async () => {
    setBusy(true);
    for (const id of picked) {
      const e = await api.createEpisode(id).catch((err) => {
        setError(clean(err));
        return null;
      });
      if (!e) continue;
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
        <div className="flex items-center gap-2">
          <Button icon={<RefreshCw className={cx('size-4', refreshing && 'animate-spin')} />} disabled={refreshing} onClick={() => void reload()}>
            Actualizar
          </Button>
        {picked.length > 0 && (
          <Button variant="primary" loading={busy} icon={<Layers className="size-4" />} onClick={batch}>
            Generar {picked.length} guion{picked.length > 1 ? 'es' : ''} en lote
          </Button>
        )}
        </div>
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

      {(businesses.length > 1 || business) && (
        <div className="mb-4 flex flex-wrap items-center gap-1.5 text-[12px]">
          <span className="mr-1 text-faint">Negocio</span>
          {[{ key: '', label: 'Todos', count: undefined as number | undefined }, ...businesses].map((b) => (
            <button
              key={b.key || 'all'}
              className={cx(
                'no-drag rounded-md border px-2 py-1 font-medium transition-colors',
                business === b.key ? 'border-brand-2/40 bg-brand-2/10 text-brand-2' : 'border-line-2 text-mute hover:text-ink',
              )}
              onClick={() => setBusiness(b.key)}
            >
              {b.label}
              {b.count !== undefined && <span className="ml-1 text-faint">{b.count}</span>}
            </button>
          ))}
          {business && !businesses.some((b) => b.key === business) && (
            <span className="text-faint">· el negocio elegido no tiene episodios en esta pestaña</span>
          )}
        </div>
      )}

      {loadError && <div className="selectable mb-4 rounded-xl border border-warn/30 bg-warn/5 px-4 py-3 text-[12.5px] text-warn">No se pudo cargar la fuente de episodios: {loadError}</div>}
      {error && <div className="selectable mb-4 rounded-xl border border-bad/30 bg-bad/5 px-4 py-3 text-[12.5px] text-bad">{error}</div>}

      {!items ? null : !list.length ? (
        <Empty icon={<CircleDashed className="size-5" />} title="La fuente no tiene episodios" hint="Revisa la fuente de episodios y la carpeta del playbook en Ajustes." />
      ) : !shown.length ? (
        <Empty icon={<CircleDashed className="size-5" />} title={`Ningún episodio ${TEAM_STATUS_LABEL[tab].toLowerCase()}`} />
      ) : (
        <div className="space-y-2">
          {shown.map((i, idx) => {
            const sel = picked.includes(i.id);
            const selectable = i.status === 'pendiente' && !i.episodeId && !takenByOther(i);
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
                    {i.businessType && (
                      <button className="no-drag" title="Filtrar por este negocio" onClick={() => setBusiness(businessKey(i.businessType))}>
                        <Tag tone="cyan">{i.businessType}</Tag>
                      </button>
                    )}
                    {i.assignee && <Tag>{i.assignee}</Tag>}
                    {i.publication && <Tag tone="ok">{[i.publication.network, i.publication.date].filter(Boolean).join(' · ')}</Tag>}
                  </div>
                  {i.solution && <p className="text-[12px] text-faint">{i.solution}</p>}
                  {i.summary && <p className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-mute">{i.summary}</p>}
                </div>
                {takenByOther(i) ? (
                  <span className="text-[12px] text-faint">Lo lleva {i.assignee}</span>
                ) : (
                <Button size="sm" variant={i.episodeId ? 'secondary' : 'ghost'} icon={i.episodeId ? <Play className="size-3.5" /> : <Wand2 className="size-3.5" />} onClick={() => open(i)}>
                  {i.episodeId ? 'Abrir' : i.status === 'pendiente' ? 'Crear' : 'Traer a AdFlow'}
                </Button>
                )}
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
