// Registry of episode sources. Adding one (a sheet, Notion…) means writing a new EpisodeSource and
// listing it here; the pipeline and the UI do not change.
import type { EpisodeSourceInfo } from '@shared/types';
import { playbookFilesSource } from './playbookFiles';
import { teamAdminSource } from './teamAdmin';
import type { EpisodeSource } from './types';

export const SOURCES: EpisodeSource[] = [playbookFilesSource, teamAdminSource];

export function getSource(id: string): EpisodeSource {
  const s = SOURCES.find((x) => x.id === id && x.implemented);
  return s ?? playbookFilesSource;
}

export function sourceInfos(): EpisodeSourceInfo[] {
  return SOURCES.map(({ id, name, description, implemented, shared }) => ({ id, name, description, implemented, shared }));
}
