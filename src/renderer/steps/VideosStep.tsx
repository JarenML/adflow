import { useEffect, useState } from 'react';
import { ArrowRight, ChevronDown, Clapperboard, ExternalLink, Eye, ImageIcon, Loader2, Lock, MessageSquare, Upload, Volume2, VolumeX, Wand2 } from 'lucide-react';
import type { ClipItem, EpisodeState, ProviderInfo, Settings, VideoClipConfig } from '@shared/types';
import { api, useLive } from '../lib/api';
import type { ChatTarget } from '../components/BrainPanel';
import { Button, Card, cx, Empty, Field, inputCls, SectionTitle, Select, Tag } from '../components/ui';
import { billingTag, planTag, providerLabel } from './PrepStep';
import { SceneModal } from '../components/SceneModal';
import type { Scene } from '@shared/schemas';
import { CLIP_S, DEFAULT_VIDEO_MODEL, videoModelFor, videoModelsFor } from '@shared/videoModels';

const DEFAULT_CFG: VideoClipConfig = { provider: 'manual', model: DEFAULT_VIDEO_MODEL, durationS: CLIP_S, resolution: '1080p' };

export function VideosStep({ episode, onTarget }: { episode: EpisodeState; onTarget: (t: ChatTarget) => void }) {
  const [clips] = useLive(() => api.clips(episode.id), [episode.id], episode.id);
  const [scriptData] = useLive(() => api.script(episode.id), [episode.id, episode.updatedAt], episode.id);
  const sceneOf = (sceneId: string): Scene | undefined => scriptData?.script?.escenas.find((x) => x.id === sceneId);
  const [viewing, setViewing] = useState<string>();
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [settings, setSettings] = useState<Settings>();
  const [estimate, setEstimate] = useState('');
  const saved = { ...DEFAULT_CFG, provider: episode.providers.video, ...episode.videoConfig, durationS: CLIP_S };
  const cfg = { ...saved, model: videoModelFor(saved.provider, saved.model).id };
  const st = episode.steps.videos.status;
  const list = clips ?? [];
  const prov = providers.find((p) => p.id === cfg.provider);
  const canGenerate = !!prov?.implemented && prov.billing !== 'manual' && (prov.billing !== 'credits' || !!settings?.allowPaidProviders);

  useEffect(() => {
    api.providers().then((p) => setProviders(p.filter((x) => x.capability === 'video')));
    api.getSettings().then(setSettings);
  }, []);
  useEffect(() => {
    api.estimate(cfg.provider, list.length || 3, cfg.model).then(setEstimate);
  }, [cfg.provider, cfg.model, list.length]);

  const setCfg = (patch: Partial<VideoClipConfig>) => {
    const next = { ...cfg, ...patch };
    void api.patchEpisode(episode.id, { videoConfig: next, providers: { ...episode.providers, video: next.provider } });
  };

  const config = (
    <Card className="p-5">
      <SectionTitle title="Configuración de los clips" hint={prov?.billing === 'credits' && !settings?.allowPaidProviders ? 'Este proveedor consume créditos. Habilítalo en Ajustes → Proveedores para generar desde aquí.' : 'No se generará nada hasta que pulses Generar.'} right={prov && (<div className="flex gap-1">{planTag(prov)}{billingTag(prov, !!settings?.allowPaidProviders)}</div>)} />
      <div className="grid grid-cols-[1.7fr_1fr_0.8fr_1fr] gap-4">
        <Field label="Generar con">
          <Select
            value={cfg.provider}
            onChange={(v) => setCfg({ provider: v })}
            options={providers.map((p) => ({ value: p.id, label: providerLabel(p) }))}
          />
        </Field>
        <Field label="Modelo">
          <Select value={cfg.model} onChange={(v) => setCfg({ model: v })} options={videoModelsFor(cfg.provider).map((m) => ({ value: m.id, label: m.label }))} />
        </Field>
        <Field label="Duración por clip">
          <div className={cx(inputCls, 'text-mute')} title="Fija: el guion reparte sus tiempos para que el gancho y cada diálogo quepan en un clip de 4 s.">
            {CLIP_S} s
          </div>
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

  const busy = st === 'working';

  // The scene open in the detail modal: a clip of the script.
  const viewClip = viewing ? list.find((c) => c.sceneId === viewing) : undefined;
  const viewScene = viewing ? sceneOf(viewing) : undefined;
  const modal = viewing && viewClip && (
    <SceneModal
      sceneId={viewing}
      scene={viewScene}
      imageUrl={viewClip.imageUrl}
      videoUrl={viewClip.url}
      prompt={viewClip.prompt}
      promptLabel="Prompt del clip"
      tags={
        (
          <Tag tone={viewClip.audio ? 'cyan' : 'default'}>
            {viewClip.audio ? <Volume2 className="size-3" /> : <VolumeX className="size-3" />}
            {viewClip.audio ? 'Con diálogo' : 'Sin audio'}
          </Tag>
        )
      }
      onClose={() => setViewing(undefined)}
    />
  );

  // The script has no clip scenes: nothing to generate, the step can be approved as is.
  if (!list.length && (st === 'review' || st === 'approved')) {
    return (
      <div className="space-y-5">
        {config}
        <Card className="p-5">
          <SectionTitle
            title="Este guion no lleva clips de video"
            hint="Todas las escenas se mostrarán como imagen con movimiento."
            right={
              <Button size="sm" variant="primary" icon={<ArrowRight className="size-3.5" />} disabled={st === 'approved'} onClick={() => api.act(episode.id, { step: 'videos', type: 'approve' })}>
                {st === 'approved' ? 'Aprobado' : 'Aprobar y seguir'}
              </Button>
            }
          />
        </Card>
        {modal}
      </div>
    );
  }

  if (!list.length) {
    return (
      <div className="space-y-5">
        {config}
        {st === 'working' ? (
          <Card className="p-5">
            <SectionTitle title="Claude está escribiendo los prompts de los clips" hint="Escenas marcadas como clip en el guion (gancho y diálogos). Aparecerán aquí en unos momentos." />
            <div className="flex gap-3 overflow-hidden">
              {[0, 1, 2].map((i) => (
                <div key={i} className="shimmer aspect-[9/16] w-[190px] shrink-0 rounded-xl" />
              ))}
            </div>
          </Card>
        ) : (
          // The choice runs by itself when Imágenes is approved; this only shows when it failed (or
          // for episodes approved before that existed).
          <Empty
            icon={<Clapperboard className="size-5" />}
            title={episode.steps.videos.error ? 'No se pudieron preparar los clips' : 'Faltan los prompts de los clips'}
            hint={episode.steps.videos.error ?? 'Se preparan automáticamente al aprobar Imágenes.'}
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
          hint={`Escenas marcadas como clip en el guion. ${canGenerate ? 'Genera cada una o sube un clip propio.' : 'Genera los clips con tu herramienta usando el prompt de cada escena y súbelos aquí.'}`}
          right={
            <div className="flex gap-2">
              {/* Hidden when every clip exists: an empty list would regenerate them all. */}
              {canGenerate && ready < list.length && (
                <Button size="sm" icon={<Wand2 className="size-3.5" />} loading={st === 'working'} disabled={st === 'approved'} onClick={() => api.act(episode.id, { step: 'videos', type: 'generate', sceneIds: list.filter((c) => !c.exists).map((c) => c.sceneId) })}>
                  {ready === 0 ? 'Generar todos' : `Generar restantes (${list.length - ready})`}
                </Button>
              )}
              <Button size="sm" variant="primary" icon={<ArrowRight className="size-3.5" />} disabled={st === 'working' || st === 'approved'} onClick={() => api.act(episode.id, { step: 'videos', type: 'approve' })}>
                {st === 'approved' ? 'Aprobado' : 'Aprobar y seguir'}
              </Button>
            </div>
          }
        />
        <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
          {list.map((c) => (
            <ClipCard
              key={c.sceneId}
              c={c}
              onView={() => setViewing(c.sceneId)}
              canGenerate={canGenerate}
              locked={busy || st === 'approved'}
              onGenerate={() => api.act(episode.id, { step: 'videos', type: 'generate', sceneIds: [c.sceneId] })}
              onImport={() => api.act(episode.id, { step: 'videos', type: 'import', sceneId: c.sceneId })}
              onAsk={() => onTarget({ sceneId: c.sceneId, label: `clip ${c.sceneId}` })}
              onRemove={() => {
                if (window.confirm(`¿Quitar el clip de ${c.sceneId}? La escena pasará a ser una imagen con movimiento.`)) void api.act(episode.id, { step: 'videos', type: 'removeClip', sceneId: c.sceneId });
              }}
            />
          ))}
        </div>
      </Card>
      {modal}
      <p className={cx('text-[11.5px] text-faint')}>
        {episode.steps.videos.error && <span className="mr-2 text-bad">{episode.steps.videos.error}.</span>}
        La verificación automática de clips (hoja de cuadros y transcripción) llega en la siguiente fase.
      </p>
    </div>
  );
}

/** One clip of the script, as a card of the carousel: the clip (or its first frame), its tags and actions. */
function ClipCard({
  c,
  canGenerate,
  locked,
  onGenerate,
  onImport,
  onAsk,
  onRemove,
  onView,
}: {
  c: ClipItem;
  onView: () => void;
  canGenerate: boolean;
  locked: boolean;
  onGenerate: () => void;
  onImport: () => void;
  onAsk: () => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const working = c.status === 'working';
  const iconBtn = 'w-8 px-0';
  return (
    <div className="w-[190px] shrink-0 overflow-hidden rounded-xl border border-line bg-panel-2/40">
      <div className="relative aspect-[9/16] w-full bg-[#0a0c11]">
        {c.url && !working ? (
          <video src={c.url} poster={c.imageUrl} className="absolute inset-0 size-full object-cover" controls loop />
        ) : c.imageUrl ? (
          <img src={c.imageUrl} className={cx('absolute inset-0 size-full object-cover', !working && 'opacity-60')} alt="" />
        ) : (
          <ImageIcon className="absolute inset-0 m-auto size-5 text-faint" />
        )}
        {working ? (
          <div className="shimmer absolute inset-0 grid place-items-center">
            <span className="flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[11px] text-mute">
              <Loader2 className="size-3 animate-spin" /> Generando…
            </span>
          </div>
        ) : (
          !c.url && (
            <span className="absolute inset-x-0 bottom-3 mx-auto w-fit rounded-full bg-black/60 px-2.5 py-1 text-[11px] text-mute">
              {c.status === 'error' ? 'Error al generar' : 'Sin generar'}
            </span>
          )
        )}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-1 bg-gradient-to-b from-black/70 to-transparent p-2">
          <span className="rounded-md bg-black/60 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-white">{c.sceneId}</span>
          <span title={c.audio ? 'Con diálogo' : 'Sin audio'} className="rounded-md bg-black/60 p-1 text-white/80">
            {c.audio ? <Volume2 className="size-3" /> : <VolumeX className="size-3" />}
          </span>
          <span className="rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] text-white/80">{c.durationS} s</span>
          <span className="ml-auto">
            {c.status === 'done' && <Tag tone="ok">Listo</Tag>}
            {c.status === 'error' && <Tag tone="bad">Error</Tag>}
          </span>
          <EyeButton onClick={onView} inline />
        </div>
      </div>
      <div className="space-y-2 p-2">
        <Button
          size="sm"
          className="w-full"
          disabled={!canGenerate || working}
          loading={working}
          icon={canGenerate ? <Wand2 className="size-3.5" /> : <Lock className="size-3.5" />}
          title={canGenerate ? '' : 'Proveedor bloqueado o manual'}
          onClick={onGenerate}
        >
          {c.exists ? 'Regenerar' : 'Generar'}
        </Button>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" className={iconBtn} icon={<Upload className="size-3.5" />} title={c.exists ? 'Reemplazar con un clip tuyo' : 'Subir un clip propio'} aria-label="Subir clip" onClick={onImport} />
          <Button size="sm" variant="ghost" className={iconBtn} icon={<MessageSquare className="size-3.5" />} title="Corregir el prompt con Claude" aria-label="Corregir prompt" onClick={onAsk} />
          {c.flowUrl && <Button size="sm" variant="ghost" className={iconBtn} icon={<ExternalLink className="size-3.5" />} title="Abrir en ElevenLabs" aria-label="Abrir en ElevenLabs" onClick={() => api.openPath(c.flowUrl!)} />}
          <Button
            size="sm"
            variant="ghost"
            className={iconBtn}
            icon={<ImageIcon className="size-3.5" />}
            disabled={working || locked}
            title="Quitar el clip (la escena pasará a ser una imagen con movimiento)"
            aria-label="Quitar clip"
            onClick={onRemove}
          />
          <button className="no-drag ml-auto p-1 text-faint hover:text-ink" onClick={() => setOpen(!open)} aria-label="Ver prompt" title="Ver motivo y prompt">
            <ChevronDown className={cx('size-4 transition-transform', open && 'rotate-180')} />
          </button>
        </div>
        {c.status === 'error' && c.error && <p className="selectable line-clamp-4 text-[11px] text-bad" title={c.error}>{c.error}</p>}
        {open && (
          <div className="space-y-1.5">
            {c.reason && <p className="text-[11.5px] text-mute">{c.reason}</p>}
            <p className="selectable max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-[#0a0c11] p-2 font-mono text-[10px] leading-relaxed text-mute">{c.prompt}</p>
          </div>
        )}
      </div>
    </div>
  );
}

/** Opens the scene's detail (image, script and prompt). */
function EyeButton({ onClick, inline }: { onClick: () => void; inline?: boolean }) {
  return (
    <button
      className={cx(
        'no-drag pointer-events-auto rounded-md bg-black/60 p-1 text-white/85 backdrop-blur-sm hover:bg-black/80 hover:text-white',
        !inline && 'absolute right-2 top-2 z-10',
      )}
      onClick={onClick}
      title="Ver la escena y su prompt"
      aria-label="Ver la escena"
    >
      <Eye className="size-3.5" />
    </button>
  );
}
