import { CheckCircle2, Circle, Film, FolderOpen } from 'lucide-react';
import type { EpisodeState } from '@shared/types';
import { api, useLive } from '../lib/api';
import { Button, Card, SectionTitle, Tag } from '../components/ui';

// Checklist §6 of the playbook. Each item will be measured automatically after the render.
const CHECKLIST = [
  'Primer cuadro con acción real y el problema claro a los 3 s',
  'Ningún tramo quieto de más de 0,4 s',
  'Logo 2,50 s, escena final 6,36 s, total 40–50 s',
  'Textos en zonas seguras y subtítulos sincronizados',
  'Sin artefactos de IA en los tramos usados',
  '−14 LUFS, pico ≤ −1,2 dBFS',
  'MP4 menor a 100 MB',
  'Último cuadro limpio (miniatura)',
  'Frases verificadas con la transcripción del video final',
];

export function RenderStep({ episode }: { episode: EpisodeState }) {
  const [data] = useLive(
    async () => {
      const [s, imgs, clips, lines] = await Promise.all([api.script(episode.id), api.images(episode.id), api.clips(episode.id), api.narration(episode.id)]);
      return { scenes: s.script?.escenas.length ?? 0, imgs, clips, lines };
    },
    [episode.id],
    episode.id,
  );
  const st = episode.steps.render.status;
  const assets = [
    ['Escenas', data?.scenes ?? 0, data?.scenes ?? 0],
    ['Imágenes', data?.imgs.filter((i) => i.exists).length ?? 0, data?.imgs.length ?? 0],
    ['Clips', data?.clips.filter((c) => c.exists).length ?? 0, data?.clips.length ?? 0],
    ['Frases de voz', data?.lines.filter((l) => l.url).length ?? 0, data?.lines.length ?? 0],
  ] as const;

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <SectionTitle title="Material del episodio" hint="Todo lo que entra al montaje en Remotion." right={<Button size="sm" variant="ghost" icon={<FolderOpen className="size-4" />} onClick={() => api.openPath(episode.dir)}>Abrir carpeta</Button>} />
        <div className="grid grid-cols-4 gap-3">
          {assets.map(([label, have, total]) => (
            <div key={label} className="rounded-xl border border-line bg-panel-2/40 px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-faint">{label}</p>
              <p className="mt-1 text-xl font-semibold">
                {have}
                <span className="text-sm text-faint"> / {total}</span>
              </p>
            </div>
          ))}
        </div>
      </Card>

      <Card className="relative overflow-hidden p-6">
        <div className="absolute -right-16 -top-16 size-64 rounded-full brand-gradient opacity-10 blur-3xl" />
        <div className="relative flex items-start gap-4">
          <div className="grid size-11 place-items-center rounded-xl brand-gradient text-white">
            <Film className="size-5" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-[15px] font-semibold">Montaje automático con Remotion</h3>
              <Tag tone="brand">Siguiente fase</Tag>
            </div>
            <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-mute">
              Claude creará el proyecto con la plantilla del playbook, armará las escenas 2D, la música y los efectos, y verás el video en vivo con
              Remotion Player antes de renderizar. Después se masteriza a −14 LUFS y se mide el checklist.
            </p>
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <SectionTitle title="Checklist antes de entregar" hint="Se medirá sobre el render final." />
        <ul className="grid grid-cols-2 gap-2">
          {CHECKLIST.map((c) => (
            <li key={c} className="flex items-start gap-2 rounded-lg border border-line bg-panel-2/30 px-3 py-2 text-[12.5px] text-mute">
              {st === 'approved' ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" /> : <Circle className="mt-0.5 size-4 shrink-0 text-faint" />}
              {c}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
