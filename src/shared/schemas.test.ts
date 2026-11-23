import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { sceneDuration, sceneKind, sceneNarration, scriptSchema } from './schemas';
import { checkScript, playbookConfigSchema } from './playbookConfig';
import preset from '../../presets/robles-ai.playbook.json';

describe('scene helpers', () => {
  it('derives kind, duration and narration', () => {
    expect(sceneKind('real_clip')).toBe('real');
    expect(sceneKind('2d_demo')).toBe('2d');
    expect(sceneKind('logo_estudio')).toBe('logo');
    expect(sceneKind('escena_final')).toBe('final');
    expect(sceneDuration({ id: 'a', tipo: 'real_imagen', inicio: 3, fin: 7.5 })).toBe(4.5);
    expect(sceneDuration({ id: 'logo', tipo: 'logo_estudio' })).toBe(2.5);
    expect(sceneNarration({ id: 'a', tipo: 'x', locucion: { quien: 'Narrador', tono: '[warm]', texto: 'Hola' } })?.text).toBe('Hola');
    expect(sceneNarration({ id: 'a', tipo: 'x', locucion: null })).toBeNull();
  });
});

// A finished episode made by hand must pass the same contract AdFlow asks Claude for.
const real = path.resolve(__dirname, '../../../robles.ai/creative/social/inmobiliarias/episodio-01-9-consultas/escenas.json');

describe.skipIf(!fs.existsSync(real))('real episode', () => {
  it('parses and passes the structural checks', () => {
    const parsed = scriptSchema.safeParse(JSON.parse(fs.readFileSync(real, 'utf8')));
    expect(parsed.success).toBe(true);
    const checks = Object.fromEntries(checkScript(parsed.data!, playbookConfigSchema.parse(preset)).map((c) => [c.id, c.ok]));
    expect(checks.hook).toBe(true);
    expect(checks['kind-logo']).toBe(true);
    expect(checks.last).toBe(true);
    expect(checks['count-2d']).toBe(true);
  });
});
