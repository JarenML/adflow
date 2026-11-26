// Crear: start a video right at step 1 of 7. Pick a pending episode of the source, check what Claude
// will read about it, choose how it is produced, and go on to the script.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, ChevronDown, ChevronUp, CircleAlert, Clapperboard, FileText, Library, RefreshCw, Settings as SettingsIcon } from 'lucide-react';
import type { EpisodeState, LibraryItem, ProviderInfo, Settings, StepId } from '@shared/types';
import { STEP_IDS } from '@shared/types';
import { api } from '../lib/api';
import { Timeline } from '../components/Timeline';
import { Button, Card, cx, Empty, SectionTitle, Select, Tag } from '../components/ui';
import { defaultChoice, PrepOptions, type PrepChoice } from '../components/PrepOptions';

const clean = (err: unknown) => String((err as Error)?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

/** The stepper before an episode exists: step 1 waiting for you, the rest locked. */
const PREVIEW = {
  steps: Object.fromEntries(STEP_IDS.map((id, i) => [id, { status: i === 0 ? 'review' : 'locked' }])),
} as unknown as EpisodeState;

export function CreateView({
  onOpen,
  onLibrary,
  onSettings,
  initialPick = '',
}: {
  onOpen: (id: string, step?: StepId) => void;
  onLibrary: () => void;
  onSettings: () => void;
  /** An episode of the source to start with already chosen. */
  initialPick?: string;
}) {
  const [items, setItems] = useState<LibraryItem[]>();
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(false);
  const [settings, setSettings] = useState<Settings>();
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [choice, setChoice] = useState<PrepChoice>();
  const [picked, setPicked] = useState(initialPick);
  const [brief, setBrief] = useState<{ id: string; text?: string; error?: string }>();
  const [showBrief, setShowBrief] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await api.library());
      setLoadError('');
    } catch (err) {
      setLoadError(clean(err));
      setItems((prev) => prev ?? []);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
    api.providers().then(setProviders);
    api.getSettings().then((s) => {
      setSettings(s);
      setChoice(defaultChoice(s));
    });
  }, [reload]);

  // Only what nobody has started: pending in the source, not in AdFlow yet, not taken by someone else.
  const me = settings?.episodeSource === 'produccion-redes' ? settings.team?.userName : undefined;
  const pending = useMemo(
    () =>
      (items ?? [])
        .filter((i) => i.status === 'pendiente' && !i.episodeId && !(i.assignee && me && i.assignee !== me))
        .sort((a, b) => a.businessType.localeCompare(b.businessType) || (a.caseNumber ?? 0) - (b.caseNumber ?? 0)),
    [items, me],
  );
  const item = pending.find((i) => i.id === picked);

  // The brief is fetched when the episode is chosen, so the person sees what Claude will read.
  useEffect(() => {
    setShowBrief(false);
    if (!picked) return setBrief(undefined);
    setBrief({ id: picked });
    api
      .sourceBrief(picked)
      .then((text) => setBrief((b) => (b?.id === picked ? { id: picked, text } : b)))
      .catch((err) => setBrief((b) => (b?.id === picked ? { id: picked, error: clean(err) } : b)));
  }, [picked]);

  const next = async () => {
    if (!item || !choice) return;
    setStarting(true);
    setError('');
    try {
      const e = await api.createEpisode(item.id);
      await api.patchEpisode(e.id, {
        providers: choice.providers,
        brain: { ...e.brain, account: choice.account, model: choice.model },
      });
      // An episode whose script someone already approved opens at its review; otherwise Claude starts it.
      if (e.steps.prep.status !== 'approved') {
        await api.act(e.id, { step: 'prep', type: 'approve' });
        await api.act(e.id, { step: 'script', type: 'generate' });
      }
      onOpen(e.id, 'script');
    } catch (err) {
      setError(clean(err));
      void reload();
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1180px] px-8 pb-28 pt-8">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Crear</h1>
          <p className="mt-1 text-[13px] text-mute">Elige un episodio y configura su producción. Después, Claude escribirá el guion.</p>
        </div>
        <Button variant="ghost" icon={<RefreshCw className={cx('size-4', loading && 'animate-spin')} />} onClick={() => void reload()}>
          Actualizar
        </Button>
      </div>

      <Card className="mb-6 overflow-hidden">
        <Timeline episode={PREVIEW} selected="prep" onSelect={() => {}} />
      </Card>

      <div className="space-y-6">
        <Card className="p-5">
          <SectionTitle title="Episodio" hint="Episodios de Robles.AI pendientes de producción." right={<Tag tone="brand">Paso 1 de 7 · Preparación</Tag>} />

          {loadError ? (
            <div className="flex items-start gap-3 rounded-xl border border-bad/30 bg-bad/5 px-4 py-3">
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-bad" />
              <div className="flex-1 text-[12.5px]">
                <p className="font-medium text-bad">No se pudo leer la lista de episodios</p>
                <p className="mt-0.5 text-mute">{loadError}</p>
              </div>
              <Button size="sm" icon={<SettingsIcon className="size-4" />} onClick={onSettings}>
                Revisar Ajustes
              </Button>
            </div>
          ) : items && !pending.length ? (
            <Empty
              icon={<Library className="size-5" />}
              title="No hay episodios pendientes"
              hint="Todos los episodios están asignados. Agrega uno nuevo en Producción de redes y pulsa Actualizar."
              action={
                <Button icon={<Library className="size-4" />} onClick={onLibrary}>
                  Ver la biblioteca
                </Button>
              }
            />
          ) : (
            <>
              <Select
                value={picked}
                onChange={setPicked}
                options={[
                  { value: '', label: items ? `Elige un episodio pendiente (${pending.length})` : 'Cargando episodios…', disabled: true },
                  ...pending.map((i) => ({ value: i.id, label: `${i.businessType} · ${i.caseNumber ? `#${i.caseNumber} ` : ''}«${i.title}»${i.solution ? ` — ${i.solution}` : ''}` })),
                ]}
              />
              {item && (
                <div className="mt-4 rounded-xl border border-line bg-panel-2/40 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Clapperboard className="size-4 text-brand-2" />
                    <p className="text-[14px] font-semibold">«{item.title}»</p>
                    {item.caseNumber && <Tag>Caso #{item.caseNumber}</Tag>}
                    <Tag tone="cyan">{item.businessType}</Tag>
                    {item.solution && <Tag tone="brand">{item.solution}</Tag>}
                  </div>
                  {item.summary && <p className="selectable mt-2 text-[13px] leading-relaxed text-mute">{item.summary}</p>}
                  <button
                    type="button"
                    onClick={() => setShowBrief((v) => !v)}
                    className="no-drag mt-3 flex items-center gap-1.5 text-[12.5px] font-medium text-brand-2 hover:underline"
                  >
                    <FileText className="size-3.5" />
                    Información del episodio para Claude
                    {showBrief ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                  </button>
                  {showBrief && (
                    <div className="selectable mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-panel px-3.5 py-3 text-[12px] leading-relaxed text-mute">
                      {brief?.error ? <span className="text-bad">{brief.error}</span> : (brief?.text ?? 'Cargando…') || 'Este episodio no tiene brief. Claude usará el título y completará el resto.'}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </Card>

        {choice && <PrepOptions value={choice} onChange={(p) => setChoice((c) => (c ? { ...c, ...p } : c))} providers={providers} settings={settings} />}
      </div>

      {/* A bar fixed at the bottom with what is chosen and the way on, like SparkClip's Create. */}
      <div className="fixed bottom-0 left-[216px] right-0 z-20 border-t border-line bg-[#0b0d12]/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1180px] items-center justify-between gap-4 px-8 py-3.5">
          <p className="min-w-0 truncate text-[12.5px] text-mute">
            {error ? <span className="text-bad">{error}</span> : item ? <>Listo para empezar: <span className="font-medium text-ink">«{item.title}»</span> · {item.businessType}</> : 'Elige un episodio para continuar.'}
          </p>
          <Button variant="primary" size="lg" disabled={!item || !choice} loading={starting} onClick={() => void next()}>
            Siguiente: Guion <ArrowRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
