// Episode source "Archivos del playbook": the catalog of cases and the tracking table that live in
// the playbook repo (PROMPT_MAESTRO_CASOS.md and SEGUIMIENTO_SERIES.md in robles.ai). Local only:
// claiming and progress stay on this computer; nobody else sees them.
import fs from 'node:fs';
import type { Playbook } from '@shared/types';
import { parseCases, parseTracking, toSourceEpisodes } from '../playbookParse';
import { read } from '../playbook';
import { resolveIn } from '../store';
import type { EpisodeSource } from './types';

function files(p: Playbook) {
  const ok = !!p.rootDir && fs.existsSync(resolveIn(p, p.casesFile));
  const cases = ok ? parseCases(read(p, p.casesFile)) : [];
  const rows = ok && fs.existsSync(resolveIn(p, p.trackingFile)) ? parseTracking(read(p, p.trackingFile)) : [];
  return { cases, rows };
}

/** Fixed series data (name, logo, link format…) and rules that apply to every case. */
function seriesFacts(md: string): string {
  const facts = /## Datos fijos de la serie([\s\S]*?)(?=\n## )/.exec(md);
  const rules = /## Reglas que aplican a todos los casos([\s\S]*?)(?=\n## )/.exec(md);
  return [facts ? `## Datos fijos de la serie${facts[1]}` : '', rules ? `## Reglas de todos los casos${rules[1]}` : '']
    .filter(Boolean)
    .join('\n\n');
}

export const playbookFilesSource: EpisodeSource = {
  id: 'playbook-files',
  name: 'Archivos del playbook',
  description: 'Catálogo de casos y seguimiento del repo del playbook. Sin conexión: solo tú ves tu avance.',
  implemented: true,
  shared: false,

  async list(p) {
    const { cases, rows } = files(p);
    return toSourceEpisodes(cases, rows);
  },

  async brief(p, episodeId) {
    const { cases, rows } = files(p);
    const ep = toSourceEpisodes(cases, rows).find((e) => e.id === episodeId);
    const block = cases.find((c) => c.number === ep?.caseNumber)?.block ?? '';
    const md = p.rootDir && fs.existsSync(resolveIn(p, p.casesFile)) ? read(p, p.casesFile) : '';
    return [block, seriesFacts(md)].filter(Boolean).join('\n\n');
  },

  async claim() {
    /* local only */
  },

  async report() {
    /* local only: the tracking file is still updated by hand */
  },
};
