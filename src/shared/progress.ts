// The one place that turns AdFlow's detailed pipeline state into the four statuses the whole
// team sees. The UI shows them and the episode source receives them; change the rules here only.
import type { EpisodeState, StepId, StepStatus, TeamProgress, TeamStatus } from './types';
import { STEP_IDS, STEPS } from './types';

export const TEAM_STATUSES: TeamStatus[] = ['pendiente', 'en_produccion', 'terminado', 'publicado'];

export const TEAM_STATUS_LABEL: Record<TeamStatus, string> = {
  pendiente: 'Pendiente',
  en_produccion: 'En proceso',
  terminado: 'Terminado',
  publicado: 'Publicado',
};

export const TEAM_STATUS_HINT: Record<TeamStatus, string> = {
  pendiente: 'Sin iniciar',
  en_produccion: 'En proceso por el equipo',
  terminado: 'Video final aprobado, pendiente de publicación',
  publicado: 'Publicado en redes',
};

export function toTeamStatus(e: Pick<EpisodeState, 'steps' | 'current' | 'publication'>): TeamProgress {
  if (e.publication) return { status: 'publicado', step: 'publish', publication: e.publication };
  if (e.steps.render.status === 'approved') return { status: 'terminado', step: 'publish' };
  const step = e.current;
  const st = e.steps[step]?.status;
  // Preparación is for reading what the episode is about: it is still pending (though already taken by
  // whoever opened it) until Preparación is approved and the script starts.
  if (e.steps.prep.status !== 'approved') return { status: 'pendiente', step: 'prep', waitingForYou: st === 'review', error: st === 'error' };
  return { status: 'en_produccion', step, waitingForYou: st === 'review', error: st === 'error' };
}

export function stepLabel(step?: StepId): string {
  return STEPS.find((s) => s.id === step)?.label ?? '';
}

/** "En proceso · Imágenes" — the one-line status used in lists. */
export function describeProgress(p: TeamProgress): string {
  const base = TEAM_STATUS_LABEL[p.status];
  return p.status === 'en_produccion' && p.step ? `${base} · ${stepLabel(p.step)}` : base;
}

/**
 * Pure: the steps of an episode someone else is producing, from what the source knows (its status
 * and step), for the read-only timeline. Steps before the current one are done; the current one is
 * in progress; a finished episode went through every step but publishing.
 */
export function watchSteps(status: TeamStatus, step?: StepId): EpisodeState['steps'] {
  const at = status === 'pendiente' ? -1 : status === 'en_produccion' ? Math.max(0, STEP_IDS.indexOf(step ?? 'prep')) : STEP_IDS.length - 1;
  const statusOf = (i: number): StepStatus => {
    if (status === 'publicado' || i < at) return 'approved';
    if (i === at) return status === 'terminado' ? 'ready' : 'working';
    return 'locked';
  };
  return Object.fromEntries(STEP_IDS.map((id, i) => [id, { status: statusOf(i) }])) as EpisodeState['steps'];
}

/** «En proceso · Voz», «Terminado» — said about someone else's episode. */
export function describeWatch(status: TeamStatus, step?: StepId): string {
  if (status === 'en_produccion') return `Va en el paso ${stepLabel(step ?? 'prep')}`;
  if (status === 'terminado') return 'Ya está terminado';
  if (status === 'publicado') return 'Ya está publicado';
  return 'Todavía no empieza';
}
