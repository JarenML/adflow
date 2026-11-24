import { ArrowRight, CheckCircle2, Circle, CircleAlert, Film, FolderOpen, RefreshCw, Wand2 } from 'lucide-react';
import type { EpisodeState } from '@shared/types';
import { api, useLive } from '../lib/api';
import { Button, Card, cx, SectionTitle, Tag } from '../components/ui';

// Checklist §6 of the playbook. Duration and size are measured; the rest is for the person to check.
const CHECKLIST = [
  'Primer cuadro con acción real y el problema claro a los 3 s',
  'Ningún tramo quieto de más de 0,4 s',
  'Logo 2,50 s y escena final 6,36 s',
  'Textos en zonas seguras y subtítulos sincronizados',
  'Sin artefactos de IA en los tramos usados',
  'Último cuadro limpio (miniatura)',
  'Frases verificadas con la transcripción del video final',
];

export function RenderStep({ episode }: { episode: EpisodeState }) {
  const [data] = useLive(
    async () => {
      const [s, imgs, clips, lines, video, report] = await Promise.all([
        api.script(episode.id),
        api.images(episode.id),
        api.clips(episode.id),
        api.narration(episode.id),
        api.finalVideo(episode.id),
        api.renderReport(episode.id),
      ]);
      return { scenes: s.script?.escenas.length ?? 0, imgs, clips, lines, video, report };
    },
    [episode.id],
    episode.id,
  );
  const st = episode.steps.render.status;
  const working = st === 'working';
  const report = data?.report;
  const assets = [
    ['Escenas', data?.scenes ?? 0, data?.scenes ?? 0],
    ['Imágenes', data?.imgs.filter((i) => i.exists).length ?? 0, data?.imgs.length ?? 0],
    ['Clips', data?.clips.filter((c) => c.exists).length ?? 0, data?.clips.length ?? 0],
    ['Frases de voz', data?.lines.filter((l) => l.url).length ?? 0, data?.lines.length ?? 0],
  ] as const;
  const missing = assets.filter(([, have, total]) => have < total).map(([label]) => label.toLowerCase());
  const durationOk = report?.durationS != null && report.durationS >= 40 && report.durationS <= 50;
  const sizeOk = report ? report.sizeMB < 100 : false;

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <SectionTitle
          title="Material del episodio"
          hint="Todo lo que entra al montaje en Remotion."
          right={
            <Button size="sm" variant="ghost" icon={<FolderOpen className="size-4" />} onClick={() => api.openPath(episode.dir)}>
              Abrir carpeta
            </Button>
          }
        />
        <div className="grid grid-cols-4 gap-3">
          {assets.map(([label, have, total]) => (
            <div key={label} className="rounded-xl border border-line bg-panel-2/40 px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-faint">{label}</p>
              <p className={cx('mt-1 text-xl font-semibold', have < total && 'text-warn')}>
                {have}
                <span className="text-sm text-faint"> / {total}</span>
              </p>
            </div>
          ))}
        </div>
        {missing.length > 0 && <p className="mt-3 text-[12px] text-warn">Falta material ({missing.join(', ')}): Claude arma esas escenas con lo que haya.</p>}
      </Card>

      {data?.video ? (
        <Card className="p-5">
          <SectionTitle
            title="Video final"
            hint={report ? `${report.file} · ${report.durationS?.toFixed(1) ?? '?'} s · ${report.sizeMB} MB${report.mastered ? ' · −14 LUFS' : ''}` : data.video.file}
            right={
              <div className="flex gap-2">
                <Button size="sm" icon={<RefreshCw className="size-3.5" />} loading={working} onClick={() => api.act(episode.id, { step: 'render', type: 'rerender' })}>
                  Renderizar de nuevo
                </Button>
                <Button size="sm" variant="primary" icon={<ArrowRight className="size-3.5" />} disabled={working || st === 'approved'} onClick={() => api.act(episode.id, { step: 'render', type: 'approve' })}>
                  {st === 'approved' ? 'Aprobado' : 'Aprobar y seguir'}
                </Button>
              </div>
            }
          />
          <div className="grid grid-cols-[320px_1fr] gap-5">
            <video key={data.video.url} src={data.video.url} controls className="aspect-[9/16] w-full rounded-xl border border-line bg-black" />
            <div className="space-y-2 text-[12.5px]">
              <p className="text-mute">¿Algo que cambiar? Pídeselo a Claude en el chat de la derecha: corrige el mismo proyecto y vuelve a renderizar.</p>
              <ul className="space-y-2">
                <li className="flex items-center gap-2">
                  {durationOk ? <CheckCircle2 className="size-4 text-ok" /> : <CircleAlert className="size-4 text-warn" />}
                  Duración 40–50 s <span className="text-faint">({report?.durationS?.toFixed(1) ?? '?'} s)</span>
                </li>
                <li className="flex items-center gap-2">
                  {sizeOk ? <CheckCircle2 className="size-4 text-ok" /> : <CircleAlert className="size-4 text-warn" />}
                  Menos de 100 MB <span className="text-faint">({report?.sizeMB ?? '?'} MB)</span>
                </li>
                <li className="flex items-center gap-2">
                  {report?.mastered ? <CheckCircle2 className="size-4 text-ok" /> : <CircleAlert className="size-4 text-warn" />}
                  Audio a −14 LUFS {report?.note && <span className="text-faint">({report.note})</span>}
                </li>
              </ul>
            </div>
          </div>
        </Card>
      ) : (
        <Card className="relative overflow-hidden p-6">
          <div className="absolute -right-16 -top-16 size-64 rounded-full brand-gradient opacity-10 blur-3xl" />
          <div className="relative flex items-start gap-4">
            <div className="grid size-11 place-items-center rounded-xl brand-gradient text-white">
              <Film className="size-5" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h3 className="text-[15px] font-semibold">Montaje con Remotion</h3>
                {working && <Tag tone="brand">En curso</Tag>}
              </div>
              <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-mute">
                AdFlow prepara el proyecto con la plantilla del playbook y el material del episodio, Claude arma las escenas (2D, logo, cierre,
                voces, subtítulos y efectos) y AdFlow renderiza a 1080×1920, masteriza a −14 LUFS y deja el MP4 en la carpeta del episodio. La
                primera vez instala Remotion y tarda unos minutos más.
              </p>
              {episode.steps.render.error && <p className="mt-2 text-[12.5px] text-bad">{episode.steps.render.error}</p>}
              <Button className="mt-4" variant="primary" icon={<Wand2 className="size-4" />} loading={working} onClick={() => api.act(episode.id, { step: 'render', type: 'build' })}>
                {episode.steps.render.error ? 'Intentar de nuevo' : 'Armar y renderizar'}
              </Button>
            </div>
          </div>
        </Card>
      )}

      <Card className="p-5">
        <SectionTitle title="Checklist antes de entregar" hint="Revísalo sobre el video final antes de aprobar." />
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
