import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, ImageIcon, X } from 'lucide-react';
import { sceneDuration, sceneNarration, screenTexts, type Scene } from '@shared/schemas';
import { cx, Tag } from './ui';

/** Copies a text and says so for a moment. */
export function CopyButton({ text, label = 'Copiar' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="no-drag flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] text-mute hover:bg-panel-2 hover:text-ink"
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
    >
      {done ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />} {done ? 'Copiado' : label}
    </button>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">{label}</p>
      <div className="selectable mt-1 text-[13px] leading-relaxed text-ink">{children}</div>
    </div>
  );
}

/**
 * A scene of the script in a modal: its image (or clip), what happens, what is said, and the prompt
 * ready to copy. Rendered in <body> so no scrolling container clips it.
 */
export function SceneModal({
  sceneId,
  scene,
  imageUrl,
  videoUrl,
  prompt,
  promptLabel = 'Prompt',
  tags,
  extra,
  onClose,
}: {
  sceneId: string;
  scene?: Scene;
  imageUrl?: string;
  videoUrl?: string;
  prompt?: string;
  promptLabel?: string;
  tags?: ReactNode;
  /** Shown after the prompt (e.g. the image's references). */
  extra?: ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const narration = scene ? sceneNarration(scene) : null;
  const dialogue = (scene as { dialogo?: { quien?: string; texto?: string } | null } | undefined)?.dialogo;
  const texts = scene ? screenTexts(scene) : [];
  const dur = scene ? sceneDuration(scene) : 0;

  return createPortal(
    <div className="no-drag fixed inset-0 z-50 grid place-items-center bg-black/70 p-8 backdrop-blur-sm" onClick={onClose}>
      {/* The height follows the image (9:16): the modal is exactly as tall as it, the text scrolls. */}
      <div className="flex h-[min(calc(100vh-4rem),540px)] w-full max-w-[800px] overflow-hidden rounded-2xl border border-line-2 bg-panel shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="relative h-full shrink-0 bg-[#0a0c11]">
          <div className="relative aspect-[9/16] h-full">
            {videoUrl ? (
              <video src={videoUrl} poster={imageUrl} className="absolute inset-0 size-full object-cover" controls loop autoPlay muted />
            ) : imageUrl ? (
              <img src={imageUrl} className="absolute inset-0 size-full object-cover" alt={sceneId} />
            ) : (
              <ImageIcon className="absolute inset-0 m-auto size-6 text-faint" />
            )}
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b border-line px-5 py-3.5">
            <span className="rounded-md bg-black/50 px-1.5 py-0.5 font-mono text-[12px] font-semibold text-white">{sceneId}</span>
            {scene?.tipo && <Tag>{scene.tipo}</Tag>}
            {dur > 0 && <Tag>{dur.toFixed(dur % 1 ? 2 : 0)} s</Tag>}
            {tags}
            <button className="ml-auto rounded-md p-1 text-faint hover:bg-panel-2 hover:text-ink" onClick={onClose} aria-label="Cerrar">
              <X className="size-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            {scene?.descripcion && <Row label="Qué se ve">{scene.descripcion}</Row>}
            {narration && (
              <Row label={`Locución · ${narration.who}`}>
                «{narration.text}»{narration.tone && <span className="ml-1.5 font-mono text-[11px] text-faint">{narration.tone}</span>}
              </Row>
            )}
            {dialogue?.texto && <Row label={`Diálogo · ${dialogue.quien ?? 'Personaje'}`}>«{dialogue.texto}»</Row>}
            {texts.length > 0 && <Row label="Texto en pantalla">{texts.join(' · ')}</Row>}
            {scene?.motivo && <Row label="Motivo">{scene.motivo}</Row>}
            {!scene && <p className="text-[12px] text-faint">Esta escena no está en escenas.json.</p>}
            {prompt && (
              <div>
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">{promptLabel}</p>
                  <CopyButton text={prompt} label="Copiar prompt" />
                </div>
                <p className={cx('selectable mt-1 whitespace-pre-wrap break-words rounded-lg bg-[#0a0c11] p-3 font-mono text-[11.5px] leading-relaxed text-mute')}>{prompt}</p>
              </div>
            )}
            {extra}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
