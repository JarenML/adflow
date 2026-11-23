import { describe, expect, it } from 'vitest';
import type { EpisodeState, StepId, StepStatus } from './types';
import { STEP_IDS } from './types';
import { describeProgress, toTeamStatus } from './progress';

function ep(statuses: Partial<Record<StepId, StepStatus>>, current: StepId, publication?: EpisodeState['publication']) {
  const steps = Object.fromEntries(STEP_IDS.map((id) => [id, { status: statuses[id] ?? 'locked' }])) as EpisodeState['steps'];
  return { steps, current, publication };
}

describe('toTeamStatus', () => {
  it('maps the pipeline to the four team statuses', () => {
    // Taken = in production, starting at Preparación (same as the admin after the claim).
    const justTaken = toTeamStatus(ep({ prep: 'review' }, 'prep'));
    expect(justTaken).toMatchObject({ status: 'en_produccion', step: 'prep', waitingForYou: true });
    expect(describeProgress(justTaken)).toBe('En producción · Preparación');
    const working = toTeamStatus(ep({ prep: 'approved', script: 'approved', images: 'review' }, 'images'));
    expect(working).toMatchObject({ status: 'en_produccion', step: 'images', waitingForYou: true });
    expect(describeProgress(working)).toBe('En producción · Imágenes');
    expect(toTeamStatus(ep({ prep: 'approved', voice: 'error' }, 'voice')).error).toBe(true);
    expect(toTeamStatus(ep({ prep: 'approved', render: 'approved' }, 'publish')).status).toBe('terminado');
    expect(toTeamStatus(ep({ prep: 'approved', render: 'approved' }, 'publish', { network: 'Meta', date: '2026-11-22' })).status).toBe('publicado');
  });
});
