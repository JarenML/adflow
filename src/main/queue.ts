// Work queue with one lane per kind of work. Every item (one Claude task, one image, one clip,
// one voice line, one render phase) is one job. Most lanes are limited per episode: each episode
// gets its own slots, so one episode never waits for another. Render is limited for the whole
// computer, because one render already takes most of the CPU. On top of that, a limit of episodes
// working at the same time, whatever step they are in.
import type { ConcurrencySettings, Lane, QueueSnapshot, StepId } from '@shared/types';

export const LANES: Lane[] = ['brain', 'image', 'clip', 'voice', 'render'];

/** 'episode': the limit applies to each episode on its own. 'global': to all episodes together. */
const SCOPE: Record<Lane, 'episode' | 'global'> = {
  brain: 'episode',
  image: 'episode',
  clip: 'episode',
  voice: 'episode',
  render: 'global',
};

/** Fixed limits; images, clips and voices come from the settings (0 = no limit). */
function lanesLimits(c: ConcurrencySettings): Record<Lane, number> {
  return { brain: 1, image: c.image, clip: c.clip, voice: c.voice, render: 1 };
}

/**
 * An episode keeps its place this long after its last job ends, so the next job of the same run
 * (Claude writes the prompts, then the images start) does not lose the place to another episode.
 */
const EPISODE_GRACE_MS = 3000;

interface Job {
  id: string;
  episodeId: string;
  step: StepId;
  label: string;
  lane: Lane;
  state: 'waiting' | 'running';
  controller: AbortController;
  run: (signal: AbortSignal) => Promise<void>;
  done: () => void;
}

export class WorkQueue {
  private jobs: Job[] = [];
  private seq = 0;
  private limits: Record<Lane, number>;
  private maxEpisodes: number;
  /** Episodes whose last job just ended: they keep their place until this time. */
  private grace = new Map<string, number>();

  constructor(
    concurrency: ConcurrencySettings,
    private onChange: (s: QueueSnapshot) => void,
  ) {
    this.limits = lanesLimits(concurrency);
    this.maxEpisodes = concurrency.episodes;
  }

  setLimits(concurrency: ConcurrencySettings): void {
    this.limits = lanesLimits(concurrency);
    this.maxEpisodes = concurrency.episodes;
    this.pump();
  }

  add(episodeId: string, step: StepId, lane: Lane, label: string, run: (signal: AbortSignal) => Promise<void>): Promise<void> {
    return new Promise((resolve) => {
      this.jobs.push({
        id: `job-${++this.seq}`,
        episodeId,
        step,
        label,
        lane,
        state: 'waiting',
        controller: new AbortController(),
        run,
        done: resolve,
      });
      this.pump();
    });
  }

  /** Cancels waiting and running jobs of one episode step. */
  cancel(episodeId: string, step?: StepId): void {
    for (const j of this.jobs) {
      if (j.episodeId === episodeId && (!step || j.step === step)) j.controller.abort();
    }
    const dropped = this.jobs.filter((j) => j.state === 'waiting' && j.controller.signal.aborted);
    this.jobs = this.jobs.filter((j) => !dropped.includes(j));
    dropped.forEach((j) => j.done());
    this.emit();
  }

  isBusy(episodeId: string, step?: StepId): boolean {
    return this.jobs.some((j) => j.episodeId === episodeId && (!step || j.step === step));
  }

  snapshot(): QueueSnapshot {
    const lanes = {} as QueueSnapshot['lanes'];
    for (const lane of LANES) {
      lanes[lane] = {
        running: this.jobs.filter((j) => j.lane === lane && j.state === 'running').length,
        waiting: this.jobs.filter((j) => j.lane === lane && j.state === 'waiting').length,
        limit: this.limits[lane],
        scope: SCOPE[lane],
      };
    }
    return {
      lanes,
      episodes: { active: this.activeEpisodes().size, limit: this.maxEpisodes },
      jobs: this.jobs.map(({ id, episodeId, step, label, lane, state }) => ({ id, episodeId, step, label, lane, state })),
    };
  }

  private emit() {
    this.onChange(this.snapshot());
  }

  /** Jobs running in the same slot group as `j` (its lane, and its episode when the lane is per episode). */
  private runningLike(j: Job): number {
    const perEpisode = SCOPE[j.lane] === 'episode';
    return this.jobs.filter((x) => x.state === 'running' && x.lane === j.lane && (!perEpisode || x.episodeId === j.episodeId)).length;
  }

  /**
   * Episodes holding a place: with a job running, or whose last job ended moments ago. An episode
   * waiting for your approval has no jobs, so it does not hold a place.
   */
  private activeEpisodes(): Set<string> {
    const t = Date.now();
    for (const [ep, until] of this.grace) if (until <= t) this.grace.delete(ep);
    return new Set([...this.jobs.filter((j) => j.state === 'running').map((j) => j.episodeId), ...this.grace.keys()]);
  }

  private pump() {
    const active = this.activeEpisodes();
    // In arrival order: a job starts when its group still has a free slot and its episode has a
    // place (it already has one, or fewer episodes than the limit are working).
    for (const j of this.jobs) {
      if (j.state !== 'waiting') continue;
      const limit = this.limits[j.lane];
      if (limit > 0 && this.runningLike(j) >= limit) continue;
      if (this.maxEpisodes > 0 && !active.has(j.episodeId) && active.size >= this.maxEpisodes) continue;
      active.add(j.episodeId);
      this.grace.delete(j.episodeId);
      j.state = 'running';
      j.run(j.controller.signal)
        .catch(() => {})
        .finally(() => {
          this.jobs = this.jobs.filter((x) => x !== j);
          if (!this.jobs.some((x) => x.episodeId === j.episodeId && x.state === 'running')) {
            this.grace.set(j.episodeId, Date.now() + EPISODE_GRACE_MS);
            setTimeout(() => this.pump(), EPISODE_GRACE_MS + 50);
          }
          j.done();
          this.pump();
        });
    }
    this.emit();
  }
}
