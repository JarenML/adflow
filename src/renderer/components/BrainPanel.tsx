// Right-hand panel: what Claude is doing (live activity) and a box to ask it for changes.
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUp, Bot, CircleAlert, CircleCheck, FileEdit, Info, Sparkles, Square } from 'lucide-react';
import type { ActivityEvent, EpisodeState, StepId } from '@shared/types';
import { STEPS } from '@shared/types';
import { api, useActivity } from '../lib/api';
import { cx, inputCls } from './ui';

const ICON: Record<ActivityEvent['kind'], typeof Info> = {
  start: Sparkles,
  text: Bot,
  tool: FileEdit,
  result: CircleCheck,
  error: CircleAlert,
  info: Info,
};

export interface ChatTarget {
  sceneId?: string;
  label: string;
}

export function BrainPanel({
  episode,
  step,
  target,
  onClearTarget,
}: {
  episode: EpisodeState;
  step: StepId;
  target?: ChatTarget;
  onClearTarget: () => void;
}) {
  const activity = useActivity(episode.id).filter((a) => a.step === step);
  const [message, setMessage] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const working = episode.steps[step].status === 'working';
  const canChat = (step === 'script' || step === 'images' || step === 'videos') && episode.steps[step].status !== 'locked';
  const hasOutput = step === 'script' ? !!episode.brain.sessions.script : step === 'images' ? !!episode.brain.sessions.images : !!episode.brain.sessions.videos;

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [activity.length]);

  const send = () => {
    const text = message.trim();
    if (!text) return;
    const action =
      step === 'script'
        ? ({ step, type: 'feedback', message: text } as const)
        : step === 'images'
          ? ({ step, type: 'feedback', message: text, sceneId: target?.sceneId } as const)
          : ({ step: 'videos', type: 'feedback', message: text, sceneId: target?.sceneId } as const);
    void api.act(episode.id, action);
    setMessage('');
    onClearTarget();
  };

  const stepLabel = STEPS.find((s) => s.id === step)?.label;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="relative grid size-7 place-items-center rounded-lg bg-[#d97757]/15 text-[#e8956f]">
            <Sparkles className="size-4" />
            {working && <span className="absolute -right-0.5 -top-0.5 size-2 animate-pulse rounded-full bg-brand-2" />}
          </div>
          <div>
            <p className="text-[13px] font-semibold">Claude</p>
            <p className="text-[11px] text-faint">{working ? 'Trabajando…' : `Paso: ${stepLabel}`}</p>
          </div>
        </div>
        {working && (
          <button className="no-drag flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-mute hover:bg-panel-2 hover:text-ink" onClick={() => api.act(episode.id, { step, type: 'cancel' })}>
            <Square className="size-3" /> Detener
          </button>
        )}
      </div>

      <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
        {activity.length === 0 && (
          <p className="pt-8 text-center text-[12px] leading-relaxed text-faint">
            Aquí verás lo que Claude hace en este paso:
            <br />
            qué lee, qué escribe y qué decide.
          </p>
        )}
        <AnimatePresence initial={false}>
          {activity.map((a, i) => {
            const Icon = ICON[a.kind];
            return (
              <motion.div
                key={`${a.at}-${i}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className={cx(
                  'flex gap-2.5 rounded-lg px-2.5 py-2 text-[12.5px] leading-relaxed',
                  a.kind === 'text' && 'bg-panel-2 text-ink',
                  a.kind === 'tool' && 'text-mute',
                  a.kind === 'info' && 'text-faint',
                  a.kind === 'start' && 'text-faint',
                  a.kind === 'result' && 'text-ok',
                  a.kind === 'error' && 'bg-bad/10 text-bad',
                )}
              >
                <Icon className="mt-0.5 size-3.5 shrink-0" />
                <span className="selectable whitespace-pre-wrap break-words">{a.text}</span>
              </motion.div>
            );
          })}
        </AnimatePresence>
        {working && (
          <div className="flex items-center gap-2 px-2.5 py-2 text-[12px] text-brand-2">
            <span className="flex gap-1">
              {[0, 1, 2].map((d) => (
                <motion.span key={d} className="size-1.5 rounded-full bg-brand-2" animate={{ opacity: [0.2, 1, 0.2] }} transition={{ duration: 1.2, repeat: Infinity, delay: d * 0.2 }} />
              ))}
            </span>
          </div>
        )}
      </div>

      <div className="border-t border-line p-3">
        {target && (
          <div className="mb-2 flex items-center justify-between rounded-md bg-brand/10 px-2.5 py-1.5 text-[11px] text-[#b6a5ff]">
            <span>Sobre: {target.label}</span>
            <button className="no-drag text-mute hover:text-ink" onClick={onClearTarget}>
              quitar
            </button>
          </div>
        )}
        <div className="relative">
          <textarea
            className={cx(inputCls, 'min-h-[76px] resize-none pr-11 text-[13px]')}
            placeholder={
              !canChat
                ? 'El chat se activa en Guion, Imágenes y Videos.'
                : !hasOutput
                  ? 'Primero genera este paso.'
                  : step === 'script'
                    ? 'Ej.: el gancho es muy lento, que el contador aparezca desde el primer cuadro…'
                    : 'Ej.: en la S02 el personaje debe mirar a cámara…'
            }
            value={message}
            disabled={!canChat || !hasOutput || working}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button
            className="no-drag absolute bottom-2.5 right-2.5 grid size-7 place-items-center rounded-md brand-gradient text-white disabled:opacity-30"
            disabled={!message.trim() || working}
            onClick={send}
            aria-label="Enviar a Claude"
          >
            <ArrowUp className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
