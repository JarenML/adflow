// What a playbook tells AdFlow about itself: which sections of its master prompt each step gets
// and how a script is checked. It lives in the playbook's own repo (adflow.playbook.json); AdFlow
// ships presets only as a fallback, so the app itself carries no brand rules.
import { z } from 'zod';
import type { StepId } from './types';
import { sceneDuration, sceneKind, type Script, type ScriptCheck, type SceneKind } from './schemas';

const range = z.tuple([z.number(), z.number()]);

export const playbookConfigSchema = z.object({
  name: z.string().optional(),
  /** Sections of the master prompt every step gets. */
  always: z.array(z.string()).default([]),
  /** Sections each step gets (ids: "N", "N-X", "pasoN", "intro"). */
  sections: z.record(z.string(), z.array(z.string())).default({}),
  script: z
    .object({
      durationS: range.optional(),
      /** The first scene's tipo must contain this (e.g. "clip" for a hook with real video). */
      hookTipoIncludes: z.string().optional(),
      /** How many scenes of a kind (real, 2d, logo, final). */
      kindCount: z.record(z.string(), range).default({}),
      requiredKinds: z.array(z.string()).default([]),
      lastKind: z.string().optional(),
      /** Words that must appear somewhere in the scenes (regex, case-insensitive). */
      mentions: z.array(z.object({ id: z.string(), label: z.string(), pattern: z.string(), missing: z.string().optional() })).default([]),
    })
    .default({ kindCount: {}, requiredKinds: [], mentions: [] }),
  /** Closing line spoken over the standard end scene, if the playbook has one. */
  closingLine: z.string().optional(),
});

export type PlaybookConfig = z.infer<typeof playbookConfigSchema>;

export function sectionsFor(cfg: PlaybookConfig, step: StepId): string[] {
  return [...cfg.always, ...(cfg.sections[step] ?? [])];
}

const KIND_LABEL: Record<string, string> = { real: 'reales', '2d': '2D', logo: 'de logo', final: 'finales' };

/** Acceptance checks of the script step, as the playbook defines them. */
export function checkScript(script: Script, cfg: PlaybookConfig): ScriptCheck[] {
  const rules = cfg.script;
  const scenes = script.escenas;
  const kinds = scenes.map((s) => sceneKind(s.tipo));
  const checks: ScriptCheck[] = [];

  if (rules.durationS) {
    const total = scenes.reduce((sum, s) => sum + sceneDuration(s), 0);
    const [min, max] = rules.durationS;
    checks.push({ id: 'duration', label: `Duración ${min}–${max} s`, ok: total >= min && total <= max, detail: `${total.toFixed(1)} s en total` });
  }
  if (rules.hookTipoIncludes) {
    const first = scenes[0];
    checks.push({
      id: 'hook',
      label: 'Gancho con video real',
      ok: !!first && first.tipo.toLowerCase().includes(rules.hookTipoIncludes),
      detail: first ? `${first.id}: ${first.tipo}` : 'Sin escenas',
    });
  }
  for (const [kind, [min, max]] of Object.entries(rules.kindCount)) {
    const n = kinds.filter((k) => k === kind).length;
    checks.push({
      id: `count-${kind}`,
      label: min === max ? `${min} escenas ${KIND_LABEL[kind] ?? kind}` : `${min}–${max} escenas ${KIND_LABEL[kind] ?? kind}`,
      ok: n >= min && n <= max,
      detail: `${n} escenas ${KIND_LABEL[kind] ?? kind}`,
    });
  }
  for (const kind of rules.requiredKinds) {
    const ok = kinds.includes(kind as SceneKind);
    checks.push({ id: `kind-${kind}`, label: kind === 'logo' ? 'Logo intermedio' : `Escena ${kind}`, ok, detail: ok ? 'Incluido' : `Falta la escena ${kind}` });
  }
  if (rules.lastKind) {
    const ok = kinds[kinds.length - 1] === rules.lastKind;
    checks.push({ id: 'last', label: rules.lastKind === 'final' ? 'Escena final estándar' : `Termina en ${rules.lastKind}`, ok, detail: ok ? 'Al final' : 'Debe ser la última escena' });
  }
  const text = JSON.stringify(scenes).toLowerCase();
  for (const m of rules.mentions) {
    const ok = new RegExp(m.pattern, 'i').test(text);
    checks.push({ id: m.id, label: m.label, ok, detail: ok ? 'Sí' : (m.missing ?? 'No aparece') });
  }
  return checks;
}
