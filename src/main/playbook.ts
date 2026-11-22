// Reads the active playbook from disk. The playbook is never copied: it stays in its own repo
// (e.g. the person's robles.ai clone), so edits by the team show up on the next read.
import fs from 'node:fs';
import type { LibraryItem, Playbook, StepId } from '@shared/types';
import { buildLibrary, composeSections, parseCases, parseTracking, sliceSections } from './playbookParse';
import { resolveIn } from './store';

function read(p: Playbook, rel: string): string {
  return fs.readFileSync(resolveIn(p, rel), 'utf8');
}

export function playbookReady(p: Playbook): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  if (!p.rootDir) problems.push('No está configurada la carpeta del playbook.');
  for (const [label, rel] of [
    ['Prompt maestro', p.masterPrompt],
    ['Catálogo de casos', p.casesFile],
    ['Seguimiento', p.trackingFile],
  ] as const) {
    if (p.rootDir && !fs.existsSync(resolveIn(p, rel))) problems.push(`${label}: no existe ${rel}`);
  }
  return { ok: problems.length === 0, problems };
}

/** The part of the master prompt the brain gets for one step. */
export function stepContext(p: Playbook, step: StepId): { text: string; missing: string[] } {
  const sections = sliceSections(read(p, p.masterPrompt));
  return composeSections(sections, [...p.always, ...p.sections[step]]);
}

export function sectionStatus(p: Playbook): { id: string; title: string; found: boolean }[] {
  const sections = sliceSections(read(p, p.masterPrompt));
  const ids = [...new Set([...p.always, ...Object.values(p.sections).flat()])];
  return ids.map((id) => ({ id, title: sections.get(id)?.title ?? '', found: sections.has(id) }));
}

export function loadLibrary(p: Playbook): LibraryItem[] {
  if (!playbookReady(p).ok) return [];
  return buildLibrary(parseCases(read(p, p.casesFile)), parseTracking(read(p, p.trackingFile)));
}

/** Fixed series data (name, logo, link format…) the brain needs in every step. */
export function seriesFacts(p: Playbook): string {
  const md = read(p, p.casesFile);
  const m = /## Datos fijos de la serie([\s\S]*?)(?=\n## )/.exec(md);
  const rules = /## Reglas que aplican a todos los casos([\s\S]*?)(?=\n## )/.exec(md);
  return [m ? `## Datos fijos de la serie${m[1]}` : '', rules ? `## Reglas de todos los casos${rules[1]}` : '']
    .filter(Boolean)
    .join('\n\n');
}
