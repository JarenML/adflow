import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, ChevronDown, CircleAlert, Clapperboard, Eye, ImageIcon, MessageSquare, RefreshCw, Wand2 } from 'lucide-react';
import type { EpisodeState, ImageItem } from '@shared/types';
import { api, useLive } from '../lib/api';
import type { ChatTarget } from '../components/BrainPanel';
import { Button, Card, cx, Empty, SectionTitle, Tag } from '../components/ui';
import { SceneModal } from '../components/SceneModal';

function ImageCard({ img, episode, onAsk, onView, active }: { img: ImageItem; episode: EpisodeState; onAsk: () => void; onView: () => void; active: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <motion.div layout initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className={cx('overflow-hidden rounded-2xl border bg-panel', active ? 'border-brand/60 glow' : 'border-line')}>
      <div className="relative aspect-[9/16] bg-[#0a0c11]">
        {img.url && img.status !== 'working' ? (
          <img src={img.url} alt={img.sceneId} className="absolute inset-0 size-full object-cover" />
        ) : img.status === 'working' ? (
          <div className="shimmer absolute inset-0 grid place-items-center">
            <span className="rounded-full bg-black/40 px-3 py-1 text-[11px] text-brand-2">Generando…</span>
          </div>
        ) : (
          <div className="absolute inset-0 grid place-items-center text-faint">
            {img.status === 'error' ? <CircleAlert className="size-6 text-bad" /> : <ImageIcon className="size-6" />}
          </div>
        )}
        <div className="absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent p-2.5">
          <span className="flex items-center gap-1.5">
            <span className="rounded-md bg-black/50 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-white">{img.sceneId}</span>
            {/* The script made this scene a video clip: this image is its first frame. */}
            {img.clip && (
              <span title="Esta escena será un clip de video; esta imagen es su primer fotograma.">
                <Tag tone="cyan">
                  <Clapperboard className="size-3" /> Clip
                </Tag>
              </span>
            )}
          </span>
          <span className="flex items-center gap-1.5">
            {img.status === 'done' && <Tag tone="ok">Lista</Tag>}
            {img.status === 'error' && <Tag tone="bad">Error</Tag>}
            {img.status === 'pending' && <Tag>Pendiente</Tag>}
            <button
              className="no-drag rounded-md bg-black/60 p-1 text-white/85 backdrop-blur-sm hover:bg-black/80 hover:text-white"
              onClick={onView}
              title="Ver la escena y su prompt"
              aria-label="Ver la escena"
            >
              <Eye className="size-3.5" />
            </button>
          </span>
        </div>
        {img.narration && (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-3 pt-10">
            <p className="line-clamp-3 text-[11.5px] leading-snug text-white/90">«{img.narration}»</p>
          </div>
        )}
      </div>
      <div className="space-y-2 p-3">
        {img.description && <p className="line-clamp-2 text-[12px] text-mute">{img.description}</p>}
        {img.error && <p className="text-[11px] text-bad">{img.error}</p>}
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" className="min-w-0 flex-1 px-2" icon={<MessageSquare className="size-3.5" />} onClick={onAsk}>
            Corregir
          </Button>
          <Button size="sm" variant="ghost" className="min-w-0 flex-1 px-2" icon={<RefreshCw className="size-3.5" />} title="Generar otra versión de esta imagen" disabled={img.status === 'working'} onClick={() => api.act(episode.id, { step: 'images', type: 'generate', sceneIds: [img.sceneId] })}>
            Otra
          </Button>
          <button className="no-drag shrink-0 p-1 text-faint hover:text-ink" onClick={() => setOpen(!open)} aria-label="Ver prompt">
            <ChevronDown className={cx('size-4 transition-transform', open && 'rotate-180')} />
          </button>
        </div>
        {open && (
          <div className="space-y-1.5">
            <p className="selectable max-h-48 overflow-auto rounded-lg bg-[#0a0c11] p-2.5 font-mono text-[10.5px] leading-relaxed text-mute">{img.prompt}</p>
            {img.references.length > 0 && <p className="text-[10.5px] text-faint">Referencias: {img.references.join(', ')}</p>}
          </div>
        )}
      </div>
    </motion.div>
  );
}

export function ImagesStep({ episode, onTarget, target }: { episode: EpisodeState; onTarget: (t: ChatTarget) => void; target?: ChatTarget }) {
  const [images] = useLive(() => api.images(episode.id), [episode.id], episode.id);
  const [scriptData] = useLive(() => api.script(episode.id), [episode.id, episode.updatedAt], episode.id);
  const [viewing, setViewing] = useState<string>();
  const [estimate, setEstimate] = useState('');
  const st = episode.steps.images.status;
  const list = images ?? [];
  useEffect(() => {
    api.estimate(episode.providers.image, list.length || 6).then(setEstimate);
  }, [episode.providers.image, list.length]);

  if (!list.length) {
    return st === 'working' ? (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="shimmer aspect-[9/16] rounded-2xl" />
        ))}
      </div>
    ) : (
      <Empty
        icon={<ImageIcon className="size-5" />}
        title={st === 'error' ? 'No se pudieron preparar las imágenes' : 'Claude prepara un prompt por escena y Codex genera cada imagen'}
        hint={episode.steps.images.error ?? `Mantiene la continuidad de personajes y objetos entre escenas. Estimado: ${estimate}.`}
        action={
          <Button variant="primary" icon={<Wand2 className="size-4" />} onClick={() => api.act(episode.id, { step: 'images', type: 'prepare' })}>
            Crear prompts y generar imágenes
          </Button>
        }
      />
    );
  }

  const viewImg = viewing ? list.find((i) => i.sceneId === viewing) : undefined;
  const done = list.filter((i) => i.status === 'done').length;
  const pending = list.filter((i) => i.status !== 'done' && i.status !== 'working').length;
  return (
    <div className="space-y-5">
      <Card className="p-5">
        <SectionTitle
          title={`${done} de ${list.length} imágenes listas`}
          hint="Usa «Corregir» para indicar a Claude qué cambiar en una imagen; reescribirá el prompt y la generará de nuevo."
          right={
            <div className="flex gap-2">
              {pending > 0 && (
                <Button size="sm" icon={<RefreshCw className="size-3.5" />} disabled={st === 'working'} onClick={() => api.act(episode.id, { step: 'images', type: 'generate' })}>
                  Generar faltantes ({pending})
                </Button>
              )}
              <Button size="sm" variant="primary" icon={<ArrowRight className="size-3.5" />} disabled={st === 'working' || st === 'approved' || done < list.length} onClick={() => api.act(episode.id, { step: 'images', type: 'approve' })}>
                {st === 'approved' ? 'Aprobado' : 'Aprobar y seguir'}
              </Button>
            </div>
          }
        />
        <div className="h-1.5 overflow-hidden rounded-full bg-line">
          <motion.div className="h-full brand-gradient" animate={{ width: `${(done / list.length) * 100}%` }} />
        </div>
      </Card>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
        {[...list].sort((a, b) => a.sceneId.localeCompare(b.sceneId, undefined, { numeric: true })).map((img) => (
          <ImageCard key={img.sceneId} img={img} episode={episode} onView={() => setViewing(img.sceneId)} active={target?.sceneId === img.sceneId} onAsk={() => onTarget({ sceneId: img.sceneId, label: `imagen ${img.sceneId}` })} />
        ))}
      </div>
      {viewImg && (
        <SceneModal
          sceneId={viewImg.sceneId}
          scene={scriptData?.script?.escenas.find((x) => x.id === viewImg.sceneId)}
          imageUrl={viewImg.status !== 'working' ? viewImg.url : undefined}
          prompt={viewImg.prompt}
          promptLabel="Prompt de la imagen"
          tags={
            viewImg.clip && (
              <Tag tone="cyan">
                <Clapperboard className="size-3" /> Clip
              </Tag>
            )
          }
          extra={
            viewImg.references.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">Referencias</p>
                <p className="selectable mt-1 font-mono text-[12px] text-mute">{viewImg.references.join(', ')}</p>
              </div>
            )
          }
          onClose={() => setViewing(undefined)}
        />
      )}
    </div>
  );
}
