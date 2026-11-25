// An episode someone else is producing, seen from here: who has it and which step it is on, read
// live from the episode source. Nothing is created on this computer and nothing is claimed or
// reported: the material (clips, voices, render) lives on that person's computer.
import { useState } from 'react';
import { ArrowLeft, Eye, RefreshCw, UserRound } from 'lucide-react';
import type { EpisodeState, LibraryItem } from '@shared/types';
import { describeWatch, watchSteps } from '@shared/progress';
import { Button, Card, cx, Tag, TeamStatusPill } from '../components/ui';
import { Timeline } from '../components/Timeline';

export function WatchView({ item, onBack, onRefresh }: { item: LibraryItem; onBack: () => void; onRefresh: () => Promise<void> }) {
  const [refreshing, setRefreshing] = useState(false);
  const steps = watchSteps(item.status, item.step);
  // The timeline reads only the steps of the episode it draws.
  const shape = { steps } as Pick<EpisodeState, 'steps'> as EpisodeState;
  const refresh = async () => {
    setRefreshing(true);
    await onRefresh().finally(() => setRefreshing(false));
  };

  return (
    <div className="mx-auto max-w-[1180px] px-8 py-8">
      <div className="mb-5 flex items-center justify-between">
        <Button size="sm" variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={onBack}>
          Biblioteca
        </Button>
        <Button size="sm" icon={<RefreshCw className={cx('size-4', refreshing && 'animate-spin')} />} disabled={refreshing} onClick={() => void refresh()}>
          Actualizar
        </Button>
      </div>

      <div className="mb-5">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">«{item.title}»</h1>
          <TeamStatusPill status={item.status} />
          {item.caseNumber && <Tag>Caso #{item.caseNumber}</Tag>}
        </div>
        <p className="mt-1 text-[13px] text-mute">{[item.businessType, item.solution].filter(Boolean).join(' · ')}</p>
      </div>

      {/* The one thing this screen says: whose episode it is. */}
      <div className="mb-6 flex items-center gap-5 rounded-2xl border border-brand/30 bg-brand/10 px-7 py-7">
        <div className="grid size-14 shrink-0 place-items-center rounded-full bg-brand/20 text-[#b6a5ff]">
          <UserRound className="size-7" />
        </div>
        <div className="min-w-0">
          <p className="text-[20px] font-semibold leading-snug text-ink">
            Este episodio lo está desarrollando {item.assignee ?? 'otra persona'}
          </p>
          <p className="mt-1 text-[13px] text-mute">
            {describeWatch(item.status, item.step)}. Solo puedes ver en qué paso va: el material está en su computadora.
          </p>
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center gap-2 border-b border-line px-5 py-3 text-[12.5px] text-mute">
          <Eye className="size-4" /> Solo lectura
        </div>
        <div className="pointer-events-none">
          <Timeline episode={shape} selected={item.step ?? 'prep'} onSelect={() => {}} />
        </div>
      </Card>
    </div>
  );
}
