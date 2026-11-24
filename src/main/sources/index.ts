// Registry of episode sources. Since Nov 2026 the only one is the team admin («Producción de redes»):
// producing videos needs a connection anyway, so the offline source (the playbook's files) is gone.
// Adding another (a sheet, Notion…) means writing a new EpisodeSource and listing it here.
import type { EpisodeSourceInfo } from '@shared/types';
import { teamAdminSource } from './teamAdmin';
import type { EpisodeSource } from './types';

export const SOURCES: EpisodeSource[] = [teamAdminSource];

export function getSource(id: string): EpisodeSource {
  return SOURCES.find((x) => x.id === id && x.implemented) ?? teamAdminSource;
}

export function sourceInfos(): EpisodeSourceInfo[] {
  return SOURCES.map(({ id, name, description, implemented, shared }) => ({ id, name, description, implemented, shared }));
}
