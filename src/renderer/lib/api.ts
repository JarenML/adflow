import { useCallback, useEffect, useState } from 'react';
import type { AdflowApi, ClaudeUsage } from '@shared/api';
import type { ActivityEvent, EpisodeState, QueueSnapshot } from '@shared/types';

declare global {
  interface Window {
    adflow: AdflowApi;
  }
}

export const api = window.adflow;

/** Loads data and reloads it whenever the given episode changes (or any episode, without id). */
export function useLive<T>(load: () => Promise<T>, deps: unknown[], episodeId?: string): [T | undefined, () => void] {
  const [data, setData] = useState<T>();
  const reload = useCallback(() => {
    load().then(setData).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    reload();
    return api.on('episode', (e: EpisodeState) => {
      if (!episodeId || e.id === episodeId) reload();
    });
  }, [reload, episodeId]);
  return [data, reload];
}

export function useEpisode(id: string): EpisodeState | undefined {
  const [ep] = useLive(() => api.episode(id), [id], id);
  return ep;
}

export function useActivity(id: string): ActivityEvent[] {
  const [items, setItems] = useState<ActivityEvent[]>([]);
  useEffect(() => {
    api.activity(id).then(setItems);
    return api.on('activity', (a: ActivityEvent) => {
      if (a.episodeId === id) setItems((prev) => [...prev.slice(-300), a]);
    });
  }, [id]);
  return items;
}

/** The Claude account's usage limits, updated every time AdFlow runs Claude. */
export function useClaudeUsage(): ClaudeUsage | undefined {
  const [u, setU] = useState<ClaudeUsage>();
  useEffect(() => {
    api.claudeUsage().then(setU);
    return api.on('claudeUsage', setU);
  }, []);
  return u;
}

export function useQueue(): QueueSnapshot | undefined {
  const [q, setQ] = useState<QueueSnapshot>();
  useEffect(() => {
    api.queue().then(setQ);
    return api.on('queue', setQ);
  }, []);
  return q;
}
