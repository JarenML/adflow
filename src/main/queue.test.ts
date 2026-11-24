import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkQueue } from './queue';
import type { Lane } from '@shared/types';

/** A job that stays running until released. */
function hold() {
  let release!: () => void;
  const p = new Promise<void>((r) => (release = r));
  return { run: () => p, release };
}

const running = (q: WorkQueue, lane: Lane, ep?: string) => q.snapshot().jobs.filter((j) => j.lane === lane && j.state === 'running' && (!ep || j.episodeId === ep)).length;

describe('WorkQueue', () => {
  it('limits images per episode, each episode with its own slots', () => {
    const q = new WorkQueue({ image: 2, clip: 1, voice: 2, episodes: 0 }, () => {});
    for (let i = 0; i < 3; i++) q.add('A', 'images', 'image', `A${i}`, hold().run);
    for (let i = 0; i < 3; i++) q.add('B', 'images', 'image', `B${i}`, hold().run);
    expect(running(q, 'image', 'A')).toBe(2);
    expect(running(q, 'image', 'B')).toBe(2);
  });

  it('images and clips do not share slots', () => {
    const q = new WorkQueue({ image: 1, clip: 1, voice: 2, episodes: 0 }, () => {});
    q.add('A', 'images', 'image', 'img', hold().run);
    q.add('A', 'videos', 'clip', 'clip', hold().run);
    expect(running(q, 'image')).toBe(1);
    expect(running(q, 'clip')).toBe(1);
  });

  it('0 means all at once', () => {
    const q = new WorkQueue({ image: 0, clip: 1, voice: 2, episodes: 0 }, () => {});
    for (let i = 0; i < 7; i++) q.add('A', 'images', 'image', `A${i}`, hold().run);
    expect(running(q, 'image')).toBe(7);
  });

  it('renders one at a time across episodes, and starts the next when one ends', async () => {
    const q = new WorkQueue({ image: 2, clip: 2, voice: 2, episodes: 0 }, () => {});
    const a = hold();
    const done = q.add('A', 'render', 'render', 'A', a.run);
    q.add('B', 'render', 'render', 'B', hold().run);
    expect(running(q, 'render')).toBe(1);
    a.release();
    await done;
    expect(q.snapshot().jobs.find((j) => j.label === 'B')?.state).toBe('running');
  });

  it('one Claude task per episode', () => {
    const q = new WorkQueue({ image: 2, clip: 2, voice: 2, episodes: 0 }, () => {});
    q.add('A', 'script', 'brain', 'A1', hold().run);
    q.add('A', 'publish', 'brain', 'A2', hold().run);
    q.add('B', 'script', 'brain', 'B1', hold().run);
    expect(running(q, 'brain', 'A')).toBe(1);
    expect(running(q, 'brain', 'B')).toBe(1);
  });

  it('voice lines per episode follow the voice limit', () => {
    const q = new WorkQueue({ image: 1, clip: 1, voice: 3, episodes: 0 }, () => {});
    for (let i = 0; i < 5; i++) q.add('A', 'voice', 'voice', `L${i}`, hold().run);
    expect(running(q, 'voice')).toBe(3);
  });

  describe('episodes at the same time', () => {
    afterEach(() => vi.useRealTimers());

    it('a third episode waits while two are working, whatever their step', () => {
      const q = new WorkQueue({ image: 2, clip: 2, voice: 2, episodes: 2 }, () => {});
      q.add('A', 'images', 'image', 'A', hold().run);
      q.add('B', 'script', 'brain', 'B', hold().run);
      q.add('C', 'voice', 'voice', 'C', hold().run);
      expect(q.snapshot().jobs.find((j) => j.label === 'C')?.state).toBe('waiting');
      expect(q.snapshot().episodes).toEqual({ active: 2, limit: 2 });
    });

    it('an episode keeps its place for a moment between steps, then frees it', async () => {
      vi.useFakeTimers();
      const q = new WorkQueue({ image: 2, clip: 2, voice: 2, episodes: 1 }, () => {});
      const a = hold();
      const done = q.add('A', 'images', 'brain', 'A prompts', a.run);
      q.add('B', 'script', 'brain', 'B', hold().run);
      a.release();
      await done;
      // A's next step arrives right away and keeps the place.
      expect(q.snapshot().jobs.find((j) => j.label === 'B')?.state).toBe('waiting');
      q.add('A', 'images', 'image', 'A img', hold().run);
      expect(q.snapshot().jobs.find((j) => j.label === 'A img')?.state).toBe('running');
    });

    it('an episode waiting for approval frees its place after the pause', async () => {
      vi.useFakeTimers();
      const q = new WorkQueue({ image: 2, clip: 2, voice: 2, episodes: 1 }, () => {});
      const a = hold();
      const done = q.add('A', 'script', 'brain', 'A', a.run);
      q.add('B', 'script', 'brain', 'B', hold().run);
      a.release();
      await done;
      await vi.advanceTimersByTimeAsync(4000);
      expect(q.snapshot().jobs.find((j) => j.label === 'B')?.state).toBe('running');
    });
  });
});
