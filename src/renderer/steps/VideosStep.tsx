import { useEffect, useState } from 'react';
import { ArrowRight, Clapperboard, ExternalLink, ImageIcon, Loader2, Lock, MessageSquare, Plus, Upload, Volume2, VolumeX, Wand2 } from 'lucide-react';
import type { ClipCandidate, EpisodeState, ProviderInfo, Settings, VideoClipConfig } from '@shared/types';
import { api, useLive } from '../lib/api';
import type { ChatTarget } from '../components/BrainPanel';
import { Button, Card, cx, Empty, Field, SectionTitle, Select, Tag } from '../components/ui';
import { billingTag } from './PrepStep';

const DEFAULT_CFG: VideoClipConfig = { provider: 'manual', model: 'veo-3.1-fast', durationS: 4, resolution: '1080p' };

export function VideosStep({ episode, onTarget }: { episode: EpisodeState; onTarget: (t: ChatTarget) => void }) {
  const [clips] = useLive(() => api.clips(episode.id), [episode.id], episode.id);
  const [candidates] = useLive<ClipCandidate[]>(() => api.clipCandidates(episode.id), [episode.id], episode.id);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [settings, setSettings] = useState<Settings>();
  const [estimate, setEstimate] = useState('');
  const cfg = { ...DEFAULT_CFG, provider: episode.providers.video, ...episode.videoConfig };
  const st = episode.steps.videos.status;
  const list = clips ?? [];
  const prov = providers.find((p) => p.id === cfg.provider);
  const canGenerate = !!prov?.implemented && prov.billing !== 'manual' && (prov.billing !== 'credits' || !!settings?.allowPaidProviders);

  useEffect(() => {
    api.providers().then((p) => setProviders(p.filter((x) => x.capability === 'video')));
    api.getSettings().then(setSettings);
  }, []);
  useEffect(() => {
    api.estimate(cfg.provider, list.length || 3).then(setEstimate);
  }, [cfg.provider, list.length]);

  const setCfg = (patch: Partial<VideoClipConfig>) => {
    const next = { ...cfg, ...patch };
    void api.patchEpisode(episode.id, { videoConfig: next, providers: { ...episode.providers, video: next.provider } });
  };

  const config = (
    <Card className="p-5">
      <SectionTitle title="Configuración de los clips" hint={prov?.billing === 'credits' && !settings?.allowPaidProviders ? 'Este proveedor gasta créditos: actívalo en Ajustes → Proveedores para generar desde aquí.' : 'Nada se genera hasta que presiones Generar.'} right={prov && billingTag(prov, !!settings?.allowPaidProviders)} />
      <div className="grid grid-cols-[1.7fr_1fr_0.8fr_1fr] gap-4">
        <Field label="Generar con">
          <Select
            value={cfg.provider}
            onChange={(v) => setCfg({ provider: v })}
            options={providers.map((p) => ({ value: p.id, label: `${p.name}${p.implemented ? '' : ' · próximamente'}` }))}
          />
        </Field>
        <Field label="Modelo">
          <Select value="veo-3.1-fast" onChange={(v) => setCfg({ model: v })} options={[{ value: 'veo-3.1-fast', label: 'Veo 3.1 Fast' }]} />
        </Field>
        <Field label="Duración por clip">
          <Select value={String(cfg.durationS)} onChange={(v) => setCfg({ durationS: Number(v) })} options={[4, 6, 8].map((d) => ({ value: String(d), label: `${d} s` }))} />
        </Field>
        <Field label="Resolución">
          <Select value={cfg.resolution} onChange={(v) => setCfg({ resolution: v as VideoClipConfig['resolution'] })} options={[{ value: '1080p', label: '1080p · 9:16' }, { value: '720p', label: '720p · 9:16' }]} />
        </Field>
      </div>
      <div className="mt-4 flex items-center justify-between rounded-xl border border-line bg-panel-2/40 px-4 py-3 text-[12.5px]">
        <span className="text-mute">
          Consumo estimado: <span className="text-ink">{estimate}</span>
        </span>
        <span className="text-faint">{prov?.costNote}</span>
      </div>
    </Card>
  );

  // Real scenes the script left as an image: one click turns them into a clip (and back, on each row).
  const others = candidates ?? [];
  const busy = st === 'working';
  const otherImages = others.length > 0 && (
    <Card className="p-5">
      <SectionTitle
        title="Imágenes sin clip"
        hint="El guion las dejó como imagen con movimiento (acercamiento en el montaje). Si una necesita video real, conviértela en clip: Claude escribe su prompt y se cambia en el guion."
      />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-3">
        {others.map((o) => (
          <div key={o.sceneId} className="overflow-hidden rounded-xl border border-line bg-panel-2/40">
            <div className="relative aspect-[9/16] w-full bg-[#0a0c11]">
              {o.imageUrl ? <img src={o.imageUrl} className="absolute inset-0 size-full object-cover" alt="" /> : <ImageIcon className="absolute inset-0 m-auto size-5 text-faint" />}
              <span className="absolute left-2 top-2 rounded-md bg-black/60 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-white">{o.sceneId}</span>
            </div>
            <div className="p-2">
              <Button
                size="sm"
                className="w-full"
                disabled={busy || st === 'approved'}
                icon={<Plus className="size-3.5" />}
                title={o.description}
                onClick={() => {
                  if (window.confirm(`¿Convertir ${o.sceneId} en clip de video? Se cambia en el guion y Claude escribe su prompt. Generarlo gasta créditos.`)) void api.act(episode.id, { step: 'videos', type: 'addClip', sceneId: o.sceneId });
                }}
              >
                Convertir en clip
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );

  // The script has no clip scenes: nothing to generate, the step can be approved as is.
  if (!list.length && (st === 'review' || st === 'approved')) {
    return (
      <div className="space-y-5">
        {config}
        <Card className="p-5">
          <SectionTitle
            title="Este guion no lleva clips de video"
            hint="Todas las escenas reales van como imagen con movimiento en el montaje. Si alguna necesita video, conviértela abajo."
            right={
              <Button size="sm" variant="primary" icon={<ArrowRight className="size-3.5" />} disabled={st === 'approved'} onClick={() => api.act(episode.id, { step: 'videos', type: 'approve' })}>
                {st === 'approved' ? 'Aprobado' : 'Aprobar y seguir'}
              </Button>
            }
          />
        </Card>
        {otherImages}
      </div>
    );
  }

  if (!list.length) {
    return (
      <div className="space-y-5">
        {config}
        {st === 'working' ? (
          <Card className="p-5">
            <SectionTitle title="Claude escribe los prompts de los clips del guion" hint="Las escenas que el guion marcó como clip (el gancho y los diálogos). Aparecen aquí en un momento." />
            <div className="space-y-4">
              {[0, 1].map((i) => (
                <div key={i} className="grid grid-cols-[150px_150px_1fr] gap-4">
                  <div className="shimmer aspect-[9/16] rounded-xl" />
                  <div className="shimmer aspect-[9/16] rounded-xl" />
                  <div className="shimmer h-40 rounded-xl" />
                </div>
              ))}
            </div>
          </Card>
        ) : (
          // The choice runs by itself when Imágenes is approved; this only shows when it failed (or
          // for episodes approved before that existed).
          <Empty
            icon={<Clapperboard className="size-5" />}
            title={episode.steps.videos.error ? 'No se pudieron preparar los clips' : 'Faltan los prompts de los clips del guion'}
            hint={episode.steps.videos.error ?? 'Se preparan solos al aprobar Imágenes: las escenas que el guion marcó como clip, con su prompt.'}
            action={
              <Button variant="primary" icon={<Wand2 className="size-4" />} onClick={() => api.act(episode.id, { step: 'videos', type: 'prepare' })}>
                {episode.steps.videos.error ? 'Reintentar' : 'Preparar ahora'}
              </Button>
            }
          />
        )}
      </div>
    );
  }

  const ready = list.filter((c) => c.exists).length;
  return (
    <div className="space-y-5">
      {config}
      <Card className="p-5">
        <SectionTitle
          title={`${ready} de ${list.length} clip${list.length === 1 ? '' : 's'} listo${list.length === 1 ? '' : 's'}`}
          hint={`Las escenas que el guion marcó como clip. ${canGenerate ? 'Genera cada una o súbela si la hiciste fuera.' : 'Genera los clips en tu herramienta (prompts en prompts_firefly.md) y súbelos aquí.'}`}
          right={
            <div className="flex gap-2">
              {canGenerate && (
                <Button size="sm" icon={<Wand2 className="size-3.5" />} loading={st === 'working'} disabled={st === 'approved'} onClick={() => api.act(episode.id, { step: 'videos', type: 'generate', sceneIds: list.filter((c) => !c.exists).map((c) => c.sceneId) })}>
                  Generar los que faltan
                </Button>
              )}
              <Button size="sm" variant="primary" icon={<ArrowRight className="size-3.5" />} disabled={st === 'working' || st === 'approved'} onClick={() => api.act(episode.id, { step: 'videos', type: 'approve' })}>
                {st === 'approved' ? 'Aprobado' : 'Aprobar y seguir'}
              </Button>
            </div>
          }
        />
        <div className="space-y-4">
          {list.map((c) => (
            <div key={c.sceneId} className="grid grid-cols-[150px_150px_1fr] gap-4 rounded-2xl border border-line bg-panel-2/40 p-3">
              {/* The scene image (first frame) */}
              <div>
                <p className="mb-1.5 text-[11px] text-faint">Imagen · primer fotograma</p>
                <div className="relative aspect-[9/16] w-full overflow-hidden rounded-xl bg-[#0a0c11]">
                  {c.imageUrl ? <img src={c.imageUrl} className="absolute inset-0 size-full object-cover" alt="" /> : <span className="absolute inset-0 grid place-items-center text-[11px] text-faint">Sin imagen</span>}
                </div>
              </div>
              {/* Its clip */}
              <div>
                <p className="mb-1.5 text-[11px] text-faint">Clip</p>
                <div className="relative aspect-[9/16] w-full overflow-hidden rounded-xl bg-[#0a0c11]">
                  {c.status === 'working' ? (
                    <div className="shimmer absolute inset-0 grid place-items-center">
                      <span className="flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[11px] text-mute">
                        <Loader2 className="size-3 animate-spin" /> Generando…
                      </span>
                    </div>
                  ) : c.url ? (
                    <video src={c.url} className="absolute inset-0 size-full object-cover" controls loop />
                  ) : (
                    <span className="absolute inset-0 grid place-items-center px-3 text-center text-[11px] text-faint">{c.status === 'error' ? 'No se generó' : 'Sin generar'}</span>
                  )}
                </div>
              </div>
              {/* Prompt and actions */}
              <div className="flex min-w-0 flex-col">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded-md bg-black/50 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-white">{c.sceneId}</span>
                  <Tag tone={c.audio ? 'cyan' : 'default'}>
                    {c.audio ? <Volume2 className="size-3" /> : <VolumeX className="size-3" />}
                    {c.audio ? 'Con diálogo' : 'Sin audio'}
                  </Tag>
                  <Tag>{c.durationS} s</Tag>
                  {c.status === 'done' && <Tag tone="ok">Listo</Tag>}
                  {c.status === 'error' && <Tag tone="bad">Error</Tag>}
                </div>
                <p className="mt-2 text-[12px] text-mute">{c.reason}</p>
                <p className="mb-1 mt-2.5 text-[11px] text-faint">Prompt</p>
                <p className="selectable max-h-48 flex-1 overflow-auto whitespace-pre-wrap rounded-lg bg-[#0a0c11] p-2.5 font-mono text-[10.5px] leading-relaxed text-mute">{c.prompt}</p>
                {c.status === 'error' && c.error && <p className="selectable mt-2 text-[11.5px] text-bad">{c.error}</p>}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Button
                    size="sm"
                    disabled={!canGenerate || c.status === 'working'}
                    loading={c.status === 'working'}
                    icon={canGenerate ? <Wand2 className="size-3.5" /> : <Lock className="size-3.5" />}
                    title={canGenerate ? '' : 'Proveedor bloqueado o manual'}
                    onClick={() => api.act(episode.id, { step: 'videos', type: 'generate', sceneIds: [c.sceneId] })}
                  >
                    {c.exists ? 'Regenerar' : 'Generar'}
                  </Button>
                  <Button size="sm" icon={<Upload className="size-3.5" />} onClick={() => api.act(episode.id, { step: 'videos', type: 'import', sceneId: c.sceneId })}>
                    {c.exists ? 'Reemplazar' : 'Subir clip'}
                  </Button>
                  <Button size="sm" variant="ghost" icon={<MessageSquare className="size-3.5" />} onClick={() => onTarget({ sceneId: c.sceneId, label: `clip ${c.sceneId}` })}>
                    Corregir prompt
                  </Button>
                  {c.flowUrl && (
                    <Button size="sm" variant="ghost" icon={<ExternalLink className="size-3.5" />} onClick={() => api.openPath(c.flowUrl!)}>
                      Abrir en ElevenLabs
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<ImageIcon className="size-3.5" />}
                    disabled={c.status === 'working' || busy || st === 'approved'}
                    title="La escena vuelve a ser imagen con movimiento (se cambia en el guion)"
                    onClick={() => {
                      if (window.confirm(`¿Quitar el clip de ${c.sceneId}? La escena vuelve a ser imagen con movimiento en el guion.`)) void api.act(episode.id, { step: 'videos', type: 'removeClip', sceneId: c.sceneId });
                    }}
                  >
                    Quitar clip
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>
      {otherImages}
      <p className={cx('text-[11.5px] text-faint')}>
        {episode.steps.videos.error && <span className="mr-2 text-bad">{episode.steps.videos.error}.</span>}
        La verificación automática de clips (hoja de cuadros y transcripción) llega en la siguiente fase.
      </p>
    </div>
  );
}
