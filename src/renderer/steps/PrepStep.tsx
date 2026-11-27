import { useEffect, useState } from 'react';
import { ArrowRight, FolderOpen } from 'lucide-react';
import type { EpisodeState, ProviderInfo, Settings } from '@shared/types';
import { api } from '../lib/api';
import { Button, Card, cx, SectionTitle } from '../components/ui';
import { PrepOptions, type PrepChoice } from '../components/PrepOptions';

export { billingTag, planTag, providerLabel } from '../components/PrepOptions';

const SOURCE_HINT: Record<string, string> = {
  'produccion-redes': 'Episodio de Producción de redes.',
};

export function PrepStep({ episode }: { episode: EpisodeState }) {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [settings, setSettings] = useState<Settings>();
  const [starting, setStarting] = useState(false);
  useEffect(() => {
    api.providers().then(setProviders);
    api.getSettings().then(setSettings);
  }, []);
  const locked = episode.steps.prep.status === 'approved';

  const choice: PrepChoice = { providers: episode.providers, account: episode.brain.account, model: episode.brain.model };
  const change = (patch: Partial<PrepChoice>) =>
    api.patchEpisode(episode.id, {
      ...(patch.providers && { providers: patch.providers }),
      ...((patch.account || patch.model) && { brain: { ...episode.brain, account: patch.account ?? episode.brain.account, model: patch.model ?? episode.brain.model } }),
    });

  const start = async () => {
    setStarting(true);
    await api.act(episode.id, { step: 'prep', type: 'approve' });
    await api.act(episode.id, { step: 'script', type: 'generate' });
    setStarting(false);
  };

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <SectionTitle
          title="Episodio"
          hint={SOURCE_HINT[episode.source?.id ?? ''] ?? 'Episodio local.'}
          right={
            <Button size="sm" variant="ghost" icon={<FolderOpen className="size-4" />} onClick={() => api.openPath(episode.dir)}>
              Abrir carpeta
            </Button>
          }
        />
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

      <PrepOptions value={choice} onChange={(p) => void change(p)} providers={providers} settings={settings} />

      <Card className="p-5">
        <SectionTitle title="Formatos" hint="El 9:16 siempre se renderiza. El 4:5 sale del mismo montaje, para los feeds." />
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-panel-2/40 px-4 py-3">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-[#7c5cff]"
            checked={episode.feed45 !== false}
            onChange={(ev) => void api.patchEpisode(episode.id, { feed45: ev.target.checked })}
          />
          <span>
            <span className="block text-[13px] font-medium text-ink">También en 4:5 (1080×1350)</span>
            <span className="block text-[12px] text-mute">Para el feed de Instagram, Facebook y LinkedIn. El 9:16 queda para Reels, Stories y TikTok. Casi duplica el tiempo de render.</span>
          </span>
        </label>
      </Card>

      <div className={cx('flex items-center justify-between rounded-2xl border px-5 py-4', locked ? 'border-ok/30 bg-ok/5' : 'border-brand/30 bg-brand/5')}>
        <div>
          <p className="text-sm font-semibold">{locked ? 'Preparación aprobada' : 'Listo para escribir el guion'}</p>
          <p className="text-[12px] text-mute">
            {locked ? 'Puedes cambiar proveedores de imágenes, video y voz antes de cada paso.' : 'Claude leerá el playbook y el caso, y escribirá el guion y las escenas.'}
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
