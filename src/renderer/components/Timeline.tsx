// The pipeline as an animated timeline: one node per step, a line that fills as steps are
// approved, a spinning ring on the step that is working and a glow on the step waiting for you.
import { motion } from 'framer-motion';
import { Check, Clapperboard, FileText, Film, ImageIcon, Lock, Mic, Settings2, TriangleAlert } from 'lucide-react';
import type { EpisodeState, StepId } from '@shared/types';
import { STEPS } from '@shared/types';
import { cx, STATUS_LABEL } from './ui';

export const STEP_ICONS: Record<StepId, typeof FileText> = {
  prep: Settings2,
  script: FileText,
  images: ImageIcon,
  videos: Clapperboard,
  voice: Mic,
  render: Film,
};

export function Timeline({ episode, selected, onSelect }: { episode: EpisodeState; selected: StepId; onSelect: (s: StepId) => void }) {
  const approved = STEPS.filter((s) => episode.steps[s.id].status === 'approved').length;
  const progress = Math.min(1, approved / (STEPS.length - 1));

  return (
    <div className="relative px-6 pt-6 pb-5">
      {/* Track */}
      <div className="absolute left-[calc(6rem/2+1.5rem)] right-[calc(6rem/2+1.5rem)] top-[3.25rem] h-[2px] rounded-full bg-line" />
      <motion.div
        className="absolute left-[calc(6rem/2+1.5rem)] top-[3.25rem] h-[2px] overflow-hidden rounded-full brand-gradient"
        initial={false}
        animate={{ width: `calc((100% - 6rem - 3rem) * ${progress})` }}
        transition={{ type: 'spring', stiffness: 60, damping: 18 }}
      >
        {/* Light travelling along the filled part */}
        <motion.div
          className="absolute inset-y-0 w-24 bg-gradient-to-r from-transparent via-white/80 to-transparent"
          animate={{ left: ['-30%', '110%'] }}
          transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut', repeatDelay: 0.6 }}
        />
      </motion.div>

      <div className="relative flex justify-between">
        {STEPS.map((s, i) => {
          const st = episode.steps[s.id];
          const Icon = st.status === 'approved' ? Check : st.status === 'locked' ? Lock : st.status === 'error' ? TriangleAlert : STEP_ICONS[s.id];
          const isSel = selected === s.id;
          return (
            <motion.button
              key={s.id}
              type="button"
              onClick={() => st.status !== 'locked' && onSelect(s.id)}
              className={cx('no-drag group flex w-24 flex-col items-center text-center', st.status === 'locked' ? 'cursor-not-allowed' : 'cursor-pointer')}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06, duration: 0.35, ease: 'easeOut' }}
            >
              <div className="relative grid size-14 place-items-center">
                {st.status === 'working' && (
                  <span className="spin-slow absolute inset-0 rounded-full" style={{ background: 'conic-gradient(from 0deg, transparent 0 55%, #22d3ee 75%, #7c5cff 100%)' }} />
                )}
                {st.status === 'review' && (
                  <motion.span
                    className="absolute inset-0 rounded-full border border-warn/60"
                    animate={{ scale: [1, 1.35], opacity: [0.7, 0] }}
                    transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut' }}
                  />
                )}
                <div
                  className={cx(
                    'relative z-10 grid size-[50px] place-items-center rounded-full border transition-all duration-300',
                    st.status === 'approved' && 'border-ok/40 bg-[#0f1f1a] text-ok',
                    st.status === 'working' && 'border-transparent bg-panel text-brand-2',
                    st.status === 'review' && 'border-warn/50 bg-[#1f1a0e] text-warn',
                    st.status === 'ready' && 'border-line-2 bg-panel-2 text-ink',
                    st.status === 'error' && 'border-bad/50 bg-[#211015] text-bad',
                    st.status === 'locked' && 'border-line bg-panel text-faint',
                    isSel && 'glow scale-105',
                  )}
                >
                  <Icon className="size-[20px]" strokeWidth={1.8} />
                </div>
              </div>
              <span className={cx('mt-2.5 text-[13px] font-semibold', isSel ? 'text-ink' : st.status === 'locked' ? 'text-faint' : 'text-mute group-hover:text-ink')}>{s.label}</span>
              <span
                className={cx(
                  'mt-0.5 text-[11px]',
                  st.status === 'working' && 'text-brand-2',
                  st.status === 'review' && 'text-warn',
                  st.status === 'approved' && 'text-ok',
                  st.status === 'error' && 'text-bad',
                  (st.status === 'locked' || st.status === 'ready') && 'text-faint',
                )}
              >
                {STATUS_LABEL[st.status]}
              </span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

/** Small version for cards in the production board. */
export function MiniTimeline({ episode }: { episode: EpisodeState }) {
  return (
    <div className="flex items-center gap-1">
      {STEPS.map((s, i) => {
        const st = episode.steps[s.id].status;
        return (
          <div key={s.id} className="flex items-center gap-1">
            <div
              title={`${s.label}: ${STATUS_LABEL[st]}`}
              className={cx(
                'size-2.5 rounded-full',
                st === 'approved' && 'bg-ok',
                st === 'working' && 'bg-brand-2 animate-pulse',
                st === 'review' && 'bg-warn',
                st === 'error' && 'bg-bad',
                st === 'ready' && 'bg-line-2 ring-1 ring-mute',
                st === 'locked' && 'bg-line-2',
              )}
            />
            {i < STEPS.length - 1 && <div className={cx('h-px w-4', st === 'approved' ? 'bg-ok/50' : 'bg-line-2')} />}
          </div>
        );
      })}
    </div>
  );
}
