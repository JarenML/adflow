// Work queue with one lane per kind of resource, so several episodes can advance at the same time
// without overloading the subscription (brain), Codex (image) or the CPU (render).
import type { QueueSnapshot, StepId } from '@shared/types';

type Lane = 'brain' | 'image' | 'render';

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

  constructor(
    private limits: Record<Lane, number>,
    private onChange: (s: QueueSnapshot) => void,
  ) {}

  setLimits(limits: Record<Lane, number>): void {
    this.limits = limits;
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
    for (const lane of ['brain', 'image', 'render'] as Lane[]) {
      lanes[lane] = {
        running: this.jobs.filter((j) => j.lane === lane && j.state === 'running').length,
        waiting: this.jobs.filter((j) => j.lane === lane && j.state === 'waiting').length,
        limit: this.limits[lane],
      };
    }
    return {
      lanes,
      jobs: this.jobs.map(({ id, episodeId, step, label, lane, state }) => ({ id, episodeId, step, label, lane, state })),
    };
  }

  private emit() {
    this.onChange(this.snapshot());
  }

  private pump() {
    for (const lane of ['brain', 'image', 'render'] as Lane[]) {
      let running = this.jobs.filter((j) => j.lane === lane && j.state === 'running').length;
      for (const j of this.jobs) {
        if (running >= this.limits[lane]) break;
        if (j.lane !== lane || j.state !== 'waiting') continue;
        j.state = 'running';
        running++;
        j.run(j.controller.signal)
          .catch(() => {})
          .finally(() => {
            this.jobs = this.jobs.filter((x) => x !== j);
            j.done();
            this.pump();
          });
      }
    }
    this.emit();
  }
}
