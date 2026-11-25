// The one place that turns AdFlow's detailed pipeline state into the four statuses the whole
// team sees. The UI shows them and the episode source receives them; change the rules here only.
import type { EpisodeState, StepId, TeamProgress, TeamStatus } from './types';
import { STEPS } from './types';

export const TEAM_STATUSES: TeamStatus[] = ['pendiente', 'en_produccion', 'terminado', 'publicado'];

export const TEAM_STATUS_LABEL: Record<TeamStatus, string> = {
  pendiente: 'Pendiente',
  en_produccion: 'En producción',
  terminado: 'Terminado',
  publicado: 'Publicado',
};

export const TEAM_STATUS_HINT: Record<TeamStatus, string> = {
  pendiente: 'Sin iniciar',
  en_produccion: 'En producción por el equipo',
  terminado: 'Video final aprobado, pendiente de publicación',
  publicado: 'Publicado en redes',
};

export function toTeamStatus(e: Pick<EpisodeState, 'steps' | 'current' | 'publication'>): TeamProgress {
  if (e.publication) return { status: 'publicado', step: 'publish', publication: e.publication };
  if (e.steps.render.status === 'approved') return { status: 'terminado', step: 'publish' };
  // An episode that exists in AdFlow was taken by someone: it is in production from Preparación on,
  // the same thing the admin shows as soon as it is claimed.
  const step = e.current;
  const st = e.steps[step]?.status;
  return { status: 'en_produccion', step, waitingForYou: st === 'review', error: st === 'error' };
}

export function stepLabel(step?: StepId): string {
  return STEPS.find((s) => s.id === step)?.label ?? '';
}

/** "En producción · Imágenes" — the one-line status used in lists. */
export function describeProgress(p: TeamProgress): string {
  const base = TEAM_STATUS_LABEL[p.status];
  return p.status === 'en_produccion' && p.step ? `${base} · ${stepLabel(p.step)}` : base;
}
