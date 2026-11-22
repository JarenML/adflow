import { useEffect, useState } from 'react';
import { ArrowRight, Clapperboard, Lock, MessageSquare, Upload, Volume2, VolumeX, Wand2 } from 'lucide-react';
import type { EpisodeState, ProviderInfo, Settings, VideoClipConfig } from '@shared/types';
import { api, useLive } from '../lib/api';
import type { ChatTarget } from '../components/BrainPanel';
import { Button, Card, cx, Empty, Field, SectionTitle, Select, Tag } from '../components/ui';
import { billingTag } from './PrepStep';

const DEFAULT_CFG: VideoClipConfig = { provider: 'manual', model: 'veo-3.1-fast', durationS: 4, resolution: '1080p' };

export function VideosStep({ episode, onTarget }: { episode: EpisodeState; onTarget: (t: ChatTarget) => void }) {
  const [clips] = useLive(() => api.clips(episode.id), [episode.id], episode.id);
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
      <SectionTitle title="Configuración de los clips" hint="Nada se genera hasta que lo confirmes. Los proveedores con créditos siguen bloqueados." right={prov && billingTag(prov, !!settings?.allowPaidProviders)} />
      <div className="grid grid-cols-[1.7fr_1fr_0.8fr_1fr] gap-4">
        <Field label="Generar con">
          <Select
            value={cfg.provider}
            onChange={(v) => setCfg({ provider: v })}
            options={providers.map((p) => ({ value: p.id, label: `${p.name}${p.implemented ? '' : ' · próximamente'}` }))}
          />
        </Field>
        <Field label="Modelo">
          <Select value={cfg.model} onChange={(v) => setCfg({ model: v })} options={[{ value: 'veo-3.1-fast', label: 'Veo 3.1 Fast' }, { value: 'veo-3.1', label: 'Veo 3.1' }]} />
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

  if (!list.length) {
    return (
      <div className="space-y-5">
        {config}
        {st === 'working' ? (
          <div className="grid grid-cols-3 gap-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="shimmer h-72 rounded-2xl" />
            ))}
          </div>
        ) : (
          <Empty
            icon={<Clapperboard className="size-5" />}
            title="Claude elige las 2–3 escenas que necesitan movimiento real"
            hint={episode.steps.videos.error ?? 'El gancho y los diálogos. Escribe sus prompts con las reglas fijas de clips del playbook.'}
            action={
              <Button variant="primary" icon={<Wand2 className="size-4" />} onClick={() => api.act(episode.id, { step: 'videos', type: 'prepare' })}>
                Elegir escenas y escribir prompts
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
          title={`${ready} de ${list.length} clips listos`}
          hint={canGenerate ? 'Genera cada clip o súbelo si lo hiciste fuera.' : 'Genera los clips en tu herramienta (prompts en prompts_firefly.md) y súbelos aquí.'}
          right={
            <Button size="sm" variant="primary" icon={<ArrowRight className="size-3.5" />} disabled={st === 'working' || st === 'approved'} onClick={() => api.act(episode.id, { step: 'videos', type: 'approve' })}>
              {st === 'approved' ? 'Aprobado' : 'Aprobar y seguir'}
            </Button>
          }
        />
        <div className="grid grid-cols-3 gap-4">
          {list.map((c) => (
            <div key={c.sceneId} className="overflow-hidden rounded-2xl border border-line bg-panel-2/40">
              <div className="relative aspect-[9/16] max-h-[420px] w-full bg-[#0a0c11]">
                {c.url ? (
                  <video src={c.url} className="absolute inset-0 size-full object-cover" controls muted loop />
                ) : c.imageUrl ? (
                  <>
                    <img src={c.imageUrl} className="absolute inset-0 size-full object-cover opacity-50" alt="" />
                    <div className="absolute inset-0 grid place-items-center">
                      <span className="rounded-full bg-black/60 px-3 py-1 text-[11px] text-mute">Primer fotograma</span>
                    </div>
                  </>
                ) : null}
                <div className="absolute left-2.5 top-2.5 flex gap-1.5">
                  <span className="rounded-md bg-black/50 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-white">{c.sceneId}</span>
                  <Tag tone={c.audio ? 'cyan' : 'default'}>
                    {c.audio ? <Volume2 className="size-3" /> : <VolumeX className="size-3" />}
                    {c.audio ? 'Con diálogo' : 'Sin audio'}
                  </Tag>
                </div>
              </div>
              <div className="space-y-2 p-3">
                <p className="text-[12px] text-mute">{c.reason}</p>
                <details className="text-[11px]">
                  <summary className="no-drag cursor-pointer text-faint hover:text-ink">Ver prompt</summary>
                  <p className="selectable mt-1.5 max-h-40 overflow-auto rounded-lg bg-[#0a0c11] p-2.5 font-mono text-[10.5px] leading-relaxed text-mute">{c.prompt}</p>
                </details>
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" disabled={!canGenerate} icon={canGenerate ? <Wand2 className="size-3.5" /> : <Lock className="size-3.5" />} title={canGenerate ? '' : 'Proveedor bloqueado o manual'}>
                    Generar
                  </Button>
                  <Button size="sm" icon={<Upload className="size-3.5" />} onClick={() => api.act(episode.id, { step: 'videos', type: 'import', sceneId: c.sceneId })}>
                    {c.exists ? 'Reemplazar' : 'Subir clip'}
                  </Button>
                  <Button size="sm" variant="ghost" icon={<MessageSquare className="size-3.5" />} onClick={() => onTarget({ sceneId: c.sceneId, label: `clip ${c.sceneId}` })}>
                    Corregir
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>
      <p className={cx('text-[11.5px] text-faint')}>
        La verificación automática de clips (hoja de cuadros y transcripción) llega en la siguiente fase.
      </p>
    </div>
  );
}
