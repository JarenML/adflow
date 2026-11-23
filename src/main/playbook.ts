// Reads the active playbook from disk. The playbook is never copied: it stays in its own repo
// (e.g. the person's robles.ai clone), so edits by the team show up on the next read.
import fs from 'node:fs';
import type { Playbook, StepId } from '@shared/types';
import { playbookConfigSchema, sectionsFor, type PlaybookConfig } from '@shared/playbookConfig';
import { composeSections, sliceSections } from './playbookParse';
import { resolveIn } from './store';
import roblesPreset from '../../presets/robles-ai.playbook.json';

/** Fallback configs for playbooks whose repo has no adflow.playbook.json yet. */
const PRESETS: Record<string, unknown> = { 'robles-ai': roblesPreset };

export function read(p: Playbook, rel: string): string {
  return fs.readFileSync(resolveIn(p, rel), 'utf8');
}

export interface LoadedConfig {
  config: PlaybookConfig;
  /** Where it came from: the playbook repo, an AdFlow preset, or nothing. */
  origin: 'playbook' | 'preset' | 'empty';
  error?: string;
}

export function loadConfig(p: Playbook): LoadedConfig {
  const file = p.rootDir ? resolveIn(p, p.configFile || 'adflow.playbook.json') : '';
  if (file && fs.existsSync(file)) {
    try {
      const parsed = playbookConfigSchema.safeParse(JSON.parse(fs.readFileSync(file, 'utf8')));
      if (parsed.success) return { config: parsed.data, origin: 'playbook' };
      return { config: playbookConfigSchema.parse({}), origin: 'empty', error: `${p.configFile}: ${parsed.error.issues[0]?.message}` };
    } catch (err) {
      return { config: playbookConfigSchema.parse({}), origin: 'empty', error: `${p.configFile}: ${String(err)}` };
    }
  }
  if (PRESETS[p.id]) return { config: playbookConfigSchema.parse(PRESETS[p.id]), origin: 'preset' };
  return { config: playbookConfigSchema.parse({}), origin: 'empty' };
}

export function playbookReady(p: Playbook): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  if (!p.rootDir) problems.push('No está configurada la carpeta del playbook.');
  else if (!fs.existsSync(resolveIn(p, p.masterPrompt))) problems.push(`Prompt maestro: no existe ${p.masterPrompt}`);
  const cfg = loadConfig(p);
  if (cfg.error) problems.push(cfg.error);
  return { ok: problems.length === 0, problems };
}

/** The part of the master prompt the brain gets for one step. */
export function stepContext(p: Playbook, step: StepId): { text: string; missing: string[] } {
  const sections = sliceSections(read(p, p.masterPrompt));
  return composeSections(sections, sectionsFor(loadConfig(p).config, step));
}

export function sectionStatus(p: Playbook): { id: string; title: string; found: boolean }[] {
  const sections = sliceSections(read(p, p.masterPrompt));
  const cfg = loadConfig(p).config;
  const ids = [...new Set([...cfg.always, ...Object.values(cfg.sections).flat()])];
  return ids.map((id) => ({ id, title: sections.get(id)?.title ?? '', found: sections.has(id) }));
}
