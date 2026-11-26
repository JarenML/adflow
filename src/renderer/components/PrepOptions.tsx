// The Preparación choices (who does each part, and the Claude account the brain runs with), shared by the Crear page,
// where they are a draft for the episode about to be created, and by an episode's own step.
import { Brain, Clapperboard, ImageIcon, Lock, Mic, Music } from 'lucide-react';
import type { Capability, ProviderInfo, Settings } from '@shared/types';
import { Card, SectionTitle, Select, Tag } from './ui';

export const CAPS: { id: Capability; label: string; icon: typeof Brain; hint: string }[] = [
  { id: 'brain', label: 'Cerebro', icon: Brain, hint: 'Escribe el guion, los prompts y revisa cada paso' },
  { id: 'image', label: 'Imágenes', icon: ImageIcon, hint: 'Un cuadro realista por escena' },
  { id: 'video', label: 'Videos', icon: Clapperboard, hint: 'Clips del gancho y los diálogos' },
  { id: 'voice', label: 'Voz del narrador', icon: Mic, hint: 'Narración con tiempos por palabra' },
  { id: 'music', label: 'Música', icon: Music, hint: 'Pista sincronizada con la línea de tiempo' },
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

/** The provider's name in a select, with its minimum plan and whether it is not built yet. */
export function providerLabel(p: ProviderInfo): string {
  return `${p.name}${p.minPlan ? ` · Plan ${p.minPlan}+` : ''}${p.implemented ? '' : ' · próximamente'}`;
}

/** Small tag with the lowest plan that can use the provider. */
export function planTag(p: ProviderInfo) {
  return p.minPlan ? <Tag>Plan {p.minPlan}+</Tag> : null;
}

export interface PrepChoice {
  providers: Record<Capability, string>;
  /** Claude account the brain (Claude Code) runs with. */
  account: string;
  /** Claude model: the default from Settings, not chosen per episode. */
  model: string;
}

/** The choices for a new episode: the person's defaults from Settings. */
export function defaultChoice(s: Settings): PrepChoice {
  return { providers: { ...s.defaults }, account: s.claude.defaultAccount, model: s.claude.model };
}

export function PrepOptions({
  value,
  onChange,
  providers,
  settings,
}: {
  value: PrepChoice;
  onChange: (patch: Partial<PrepChoice>) => void;
  providers: ProviderInfo[];
  settings?: Settings;
}) {
  const accounts = settings?.claude.accounts ?? [];
  const allowPaid = !!settings?.allowPaidProviders;
  return (
    <>
      <Card className="p-5">
        <SectionTitle title="Conexiones" hint="Proveedor de cada parte del video. Se toman de los valores predeterminados de Ajustes; los que consumen créditos deben habilitarse allí." />
        <div className="space-y-2.5">
          {CAPS.map((cap) => {
            const opts = providers.filter((p) => p.capability === cap.id);
            const current = opts.find((p) => p.id === value.providers[cap.id]);
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
                  {cap.id === 'brain' ? (
                    // The brain is always Claude Code: what is chosen is the Claude account it runs with.
                    <Select
                      value={value.account}
                      onChange={(v) => onChange({ account: v })}
                      options={accounts.map((a) => ({ value: a.id, label: `${current?.name ?? 'Claude Code'} · ${a.label}` }))}
                    />
                  ) : (
                    <Select
                      value={value.providers[cap.id]}
                      onChange={(v) => onChange({ providers: { ...value.providers, [cap.id]: v } })}
                      options={opts.map((p) => ({
                        value: p.id,
                        label: providerLabel(p),
                        disabled: !p.implemented || (p.billing === 'credits' && !allowPaid),
                      }))}
                    />
                  )}
                  {current && <p className="mt-1.5 text-[11px] text-faint">{current.costNote}</p>}
                </div>
                <div className="flex w-36 justify-end gap-1">
                  {current && planTag(current)}
                  {current && billingTag(current, allowPaid)}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </>
  );
}
