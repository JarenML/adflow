import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, FolderOpen } from 'lucide-react';
import type { StepId } from '@shared/types';
import { STEPS } from '@shared/types';
import { api, useEpisode } from '../lib/api';
import { BrainPanel, type ChatTarget } from '../components/BrainPanel';
import { Timeline } from '../components/Timeline';
import { Button, StatusPill, Tag } from '../components/ui';
import { PrepStep } from '../steps/PrepStep';
import { ScriptStep } from '../steps/ScriptStep';
import { ImagesStep } from '../steps/ImagesStep';
import { VideosStep } from '../steps/VideosStep';
import { VoiceStep } from '../steps/VoiceStep';
import { RenderStep } from '../steps/RenderStep';

export function EpisodeView({ id, initialStep, onBack }: { id: string; initialStep?: StepId; onBack: () => void }) {
  const episode = useEpisode(id);
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
        <aside className="w-[360px] shrink-0 border-l border-line bg-panel/60">
          <BrainPanel episode={episode} step={step} target={target} onClearTarget={() => setTarget(undefined)} />
        </aside>
      </div>
    </div>
  );
}
