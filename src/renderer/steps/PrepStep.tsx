import { useEffect, useState } from 'react';
import { ArrowRight, Brain, Clapperboard, FolderOpen, ImageIcon, Lock, Mic, Music } from 'lucide-react';
import type { Capability, EpisodeState, ProviderInfo, Settings } from '@shared/types';
import { api } from '../lib/api';
import { Button, Card, cx, Field, SectionTitle, Select, Tag } from '../components/ui';

const CAPS: { id: Capability; label: string; icon: typeof Brain; hint: string }[] = [
  { id: 'brain', label: 'Cerebro', icon: Brain, hint: 'Escribe el guion, los prompts y revisa cada paso' },
  { id: 'image', label: 'Imágenes', icon: ImageIcon, hint: 'Un cuadro realista por escena' },
  { id: 'video', label: 'Videos', icon: Clapperboard, hint: 'Clips del gancho y los diálogos' },
  { id: 'voice', label: 'Voz del narrador', icon: Mic, hint: 'Narración con tiempos por palabra' },
  { id: 'music', label: 'Música', icon: Music, hint: 'Pista calzada a la línea de tiempo' },
];

export function billingTag(p: ProviderInfo, allowPaid: boolean) {
  if (p.billing === 'subscription') return <Tag tone="brand">Suscripción</Tag>;
  if (p.billing === 'free') return <Tag tone="ok">Gratis</Tag>;
  if (p.billing === 'manual') return <Tag>Manual</Tag>;
  return (
    <Tag tone={p.implemented && allowPaid ? 'warn' : 'default'}>
      {(!p.implemented || !allowPaid) && <Lock className="size-3" />} Créditos
    </Tag>
  );
}

export function PrepStep({ episode }: { episode: EpisodeState }) {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [settings, setSettings] = useState<Settings>();
  const [starting, setStarting] = useState(false);
  useEffect(() => {
    api.providers().then(setProviders);
    api.getSettings().then(setSettings);
  }, []);
  const prep = episode.steps.prep.status;
  const locked = prep === 'approved';

  const choose = (cap: Capability, id: string) => api.patchEpisode(episode.id, { providers: { ...episode.providers, [cap]: id } });

  const start = async () => {
    setStarting(true);
    await api.act(episode.id, { step: 'prep', type: 'approve' });
    await api.act(episode.id, { step: 'script', type: 'generate' });
    setStarting(false);
  };

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <SectionTitle title="Episodio" hint="Sale del catálogo de casos del playbook." right={<Button size="sm" variant="ghost" icon={<FolderOpen className="size-4" />} onClick={() => api.openPath(episode.dir)}>Abrir carpeta</Button>} />
        <div className="grid grid-cols-2 gap-4 text-[13px] lg:grid-cols-4">
          {[
            ['Caso', episode.caseNumber ? `#${episode.caseNumber}` : '—'],
            ['Tipo de negocio', episode.businessType ?? '—'],
            ['Solución', episode.solution ?? '—'],
            ['Carpeta', `${episode.serie}/${episode.slug}`],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl border border-line bg-panel-2/50 px-3.5 py-3">
              <p className="text-[11px] uppercase tracking-wide text-faint">{k}</p>
              <p className="selectable mt-1 font-medium text-ink break-words">{v}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-5">
        <SectionTitle title="Conexiones de este episodio" hint="Vienen de tus valores por defecto (Ajustes). Los proveedores con créditos están bloqueados hasta que los habilites." />
        <div className="space-y-2.5">
          {CAPS.map((cap) => {
            const opts = providers.filter((p) => p.capability === cap.id);
            const current = opts.find((p) => p.id === episode.providers[cap.id]);
            const Icon = cap.icon;
            return (
              <div key={cap.id} className="grid grid-cols-[220px_1fr_auto] items-center gap-4 rounded-xl border border-line bg-panel-2/40 px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="grid size-9 place-items-center rounded-lg bg-panel-2 text-mute">
                    <Icon className="size-[18px]" />
                  </div>
                  <div>
                    <p className="text-[13px] font-semibold">{cap.label}</p>
                    <p className="text-[11px] text-faint">{cap.hint}</p>
                  </div>
                </div>
                <div>
                  <Select
                    value={episode.providers[cap.id]}
                    disabled={locked && cap.id === 'brain'}
                    onChange={(v) => choose(cap.id, v)}
                    options={opts.map((p) => ({
                      value: p.id,
                      label: `${p.name}${p.implemented ? '' : ' · próximamente'}`,
                      disabled: !p.implemented || (p.billing === 'credits' && !settings?.allowPaidProviders),
                    }))}
                  />
                  {current && <p className="mt-1.5 text-[11px] text-faint">{current.costNote}</p>}
                </div>
                <div className="w-28 text-right">{current && billingTag(current, !!settings?.allowPaidProviders)}</div>
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="p-5">
        <SectionTitle title="Cerebro" hint="Claude Code corre en tu computadora con la cuenta elegida." />
        <div className="grid grid-cols-3 gap-4">
          <Field label="Cuenta de Claude">
            <Select
              value={episode.brain.account}
              onChange={(v) => api.patchEpisode(episode.id, { brain: { ...episode.brain, account: v } })}
              options={(settings?.claude.accounts ?? []).map((a) => ({ value: a.id, label: a.label }))}
            />
          </Field>
          <Field label="Modelo">
            <Select
              value={episode.brain.model}
              onChange={(v) => api.patchEpisode(episode.id, { brain: { ...episode.brain, model: v } })}
              options={[
                { value: 'opus', label: 'Opus (más criterio)' },
                { value: 'sonnet', label: 'Sonnet (más rápido)' },
              ]}
            />
          </Field>
          <Field label="Voz del cierre" hint="Quién dice «¡Robles punto a i!» al final">
            <Select
              value={episode.closingVoice}
              onChange={(v) => api.patchEpisode(episode.id, { closingVoice: v as EpisodeState['closingVoice'] })}
              options={[
                { value: 'narrator', label: 'El narrador del video' },
                { value: 'template', label: 'La de la plantilla' },
              ]}
            />
          </Field>
        </div>
      </Card>

      <div className={cx('flex items-center justify-between rounded-2xl border px-5 py-4', locked ? 'border-ok/30 bg-ok/5' : 'border-brand/30 bg-brand/5')}>
        <div>
          <p className="text-sm font-semibold">{locked ? 'Preparación aprobada' : 'Todo listo para escribir el guion'}</p>
          <p className="text-[12px] text-mute">
            {locked ? 'Puedes cambiar proveedores de imágenes, video y voz antes de cada paso.' : 'Claude leerá el playbook y el caso, y escribirá guion.md y escenas.json.'}
          </p>
        </div>
        {!locked && (
          <Button variant="primary" size="lg" loading={starting} icon={<ArrowRight className="size-4" />} onClick={start}>
            Comenzar con el guion
          </Button>
        )}
      </div>
    </div>
  );
}
