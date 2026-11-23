// Registry of episode sources. Adding one (the team admin, a sheet, Notion…) means writing a new
// EpisodeSource and listing it here; the pipeline and the UI do not change.
import type { EpisodeSourceInfo } from '@shared/types';
import { playbookFilesSource } from './playbookFiles';
import type { EpisodeSource } from './types';

/** Listed so people can see it is coming; it connects to «Producción de redes» in the admin. */
const teamAdminSource: EpisodeSource = {
  id: 'produccion-redes',
  name: 'Producción de redes (admin)',
  description: 'Episodios del equipo en el admin: quién lleva cada uno, en qué paso va y cuáles están publicados.',
  implemented: false,
  shared: true,
  async list() {
    throw new Error('La conexión con «Producción de redes» llega en la siguiente fase.');
  },
  async brief() {
    return '';
  },
  async claim() {},
  async report() {},
};

export const SOURCES: EpisodeSource[] = [playbookFilesSource, teamAdminSource];

export function getSource(id: string): EpisodeSource {
  const s = SOURCES.find((x) => x.id === id && x.implemented);
  return s ?? playbookFilesSource;
}

export function sourceInfos(): EpisodeSourceInfo[] {
  return SOURCES.map(({ id, name, description, implemented, shared }) => ({ id, name, description, implemented, shared }));
}
