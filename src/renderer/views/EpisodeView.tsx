import { useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, FolderOpen, PanelRightOpen } from 'lucide-react';
import type { StepId } from '@shared/types';
import { STEPS } from '@shared/types';
import { api, useEpisode } from '../lib/api';
import { BrainPanel, type ChatTarget } from '../components/BrainPanel';
import { Timeline } from '../components/Timeline';
import { Button, StatusPill, Tag, TeamStatusPill } from '../components/ui';
import { PrepStep } from '../steps/PrepStep';
import { ScriptStep } from '../steps/ScriptStep';
import { ImagesStep } from '../steps/ImagesStep';
import { VideosStep } from '../steps/VideosStep';
import { VoiceStep } from '../steps/VoiceStep';
import { RenderStep } from '../steps/RenderStep';
import { PublishStep } from '../steps/PublishStep';
import { toTeamStatus } from '@shared/progress';

const CHAT_DEFAULT = 360;
const CHAT_MIN = 260;
const CHAT_MAX = 640;
const CHAT_KEY = 'adflow.chatPanel';

/** Width and collapsed state of Claude's panel, remembered on this computer. */
function useChatPanel() {
  const saved = (() => {
    try {
      return JSON.parse(localStorage.getItem(CHAT_KEY) ?? '{}') as { width?: number; collapsed?: boolean };
    } catch {
      return {};
    }
  })();
  const [width, setWidthState] = useState(Math.min(CHAT_MAX, Math.max(CHAT_MIN, saved.width ?? CHAT_DEFAULT)));
  const [collapsed, setCollapsed] = useState(!!saved.collapsed);
  useEffect(() => {
    try {
      localStorage.setItem(CHAT_KEY, JSON.stringify({ width, collapsed }));
    } catch {
      /* storage unavailable: just don't remember it */
    }
  }, [width, collapsed]);
  const setWidth = (w: number) => setWidthState(Math.min(CHAT_MAX, Math.max(CHAT_MIN, Math.round(w))));
  const startDrag = (e: ReactPointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const move = (ev: PointerEvent) => setWidth(startW + (startX - ev.clientX));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return { width, setWidth, collapsed, setCollapsed, startDrag };
}

export function EpisodeView({ id, initialStep, onBack }: { id: string; initialStep?: StepId; onBack: () => void }) {
  const episode = useEpisode(id);
  const chat = useChatPanel();
  const [selected, setSelected] = useState<StepId | null>(initialStep ?? null);
  const [target, setTarget] = useState<ChatTarget>();

  // Follow the episode's current step until the person picks another one.
  useEffect(() => {
    if (episode && selected === null) setSelected(episode.current);
  }, [episode, selected]);

  if (!episode) return <div className="p-10 text-mute">Cargando…</div>;
  const step = selected ?? episode.current;
  const meta = STEPS.find((s) => s.id === step)!;
  const panel = {
    prep: <PrepStep episode={episode} />,
    script: <ScriptStep episode={episode} />,
    images: <ImagesStep episode={episode} onTarget={setTarget} target={target} />,
    videos: <VideosStep episode={episode} onTarget={setTarget} />,
    voice: <VoiceStep episode={episode} />,
    render: <RenderStep episode={episode} />,
    publish: <PublishStep episode={episode} />,
  }[step];

  return (
    <div className="flex h-full flex-col">
      <header className="drag flex items-center gap-4 border-b border-line px-6 pb-3 pt-3">
        <button className="no-drag grid size-8 place-items-center rounded-lg text-mute hover:bg-panel-2 hover:text-ink" onClick={onBack} aria-label="Volver">
          <ChevronLeft className="size-5" />
        </button>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-[17px] font-semibold">{episode.title}</h1>
            {episode.caseNumber && <Tag>Caso #{episode.caseNumber}</Tag>}
            <TeamStatusPill progress={toTeamStatus(episode)} />
          </div>
          <p className="truncate text-[12px] text-faint">
            {episode.businessType} · {episode.solution}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2 pr-36">
          <Button size="sm" variant="ghost" icon={<FolderOpen className="size-4" />} onClick={() => api.openPath(episode.dir)}>
            Carpeta
          </Button>
        </div>
      </header>

      <div className="border-b border-line bg-panel/40">
        <Timeline
          episode={episode}
          selected={step}
          onSelect={(s) => {
            setSelected(s);
            setTarget(undefined);
          }}
        />
      </div>

      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1100px] px-8 py-6">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">{meta.label}</h2>
                <p className="text-[13px] text-mute">{meta.hint}</p>
              </div>
              <StatusPill status={episode.steps[step].status} />
            </div>
            {episode.steps[step].status === 'error' && episode.steps[step].error && (
              <div className="selectable mb-5 rounded-xl border border-bad/30 bg-bad/5 px-4 py-3 text-[12.5px] text-bad">{episode.steps[step].error}</div>
            )}
            <AnimatePresence mode="wait">
              <motion.div key={step} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>
                {panel}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
        {chat.collapsed ? (
          <aside className="flex w-11 shrink-0 flex-col items-center border-l border-line bg-panel/60 pt-3">
            <button className="no-drag grid size-8 place-items-center rounded-lg text-mute hover:bg-panel-2 hover:text-ink" title="Mostrar el panel de Claude" onClick={() => chat.setCollapsed(false)}>
              <PanelRightOpen className="size-4" />
            </button>
            <span className="mt-3 text-[11px] text-faint [writing-mode:vertical-rl]">Claude</span>
          </aside>
        ) : (
          <aside className="relative shrink-0 border-l border-line bg-panel/60" style={{ width: chat.width }}>
            {/* Drag to resize; double click goes back to the default width. */}
            <div
              role="separator"
              aria-orientation="vertical"
              title="Arrastra para cambiar el ancho · doble clic: ancho normal"
              className="no-drag group absolute inset-y-0 -left-1.5 z-10 w-3 cursor-col-resize"
              onPointerDown={chat.startDrag}
              onDoubleClick={() => chat.setWidth(CHAT_DEFAULT)}
            >
              <div className="mx-auto h-full w-px bg-transparent transition-colors group-hover:bg-brand/60" />
            </div>
            <BrainPanel episode={episode} step={step} target={target} onClearTarget={() => setTarget(undefined)} onCollapse={() => chat.setCollapsed(true)} />
          </aside>
        )}
      </div>
    </div>
  );
}
