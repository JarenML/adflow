import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { composeSections, episodeSlug, serieSlug, sliceSections } from './playbookParse';
import preset from '../../presets/robles-ai.playbook.json';

const sample = `Intro line
## 0. DATOS
data
## 1. ESTRUCTURA
estructura
### 1-B. Transiciones
trans
## 2. PIPELINE
carpeta
**Paso 1. Guion.** escribir
mas
**Paso 2. Imágenes.** generar
## 7. PLANTILLAS
### A. Logo
logo
`;

describe('sliceSections', () => {
  it('splits top sections, subsections and pipeline steps', () => {
    const s = sliceSections(sample);
    expect(s.get('intro')?.text).toBe('Intro line');
    expect(s.get('1')?.text).toContain('trans');
    expect(s.get('1-B')?.text).toBe('### 1-B. Transiciones\ntrans');
    expect(s.get('2')?.text).toBe('## 2. PIPELINE\ncarpeta');
    expect(s.get('paso1')?.text).toContain('mas');
    expect(s.get('paso2')?.text).not.toContain('PLANTILLAS');
    expect(s.get('7-A')?.text).toContain('logo');
  });

  it('skips a subsection when its parent is requested and reports missing ids', () => {
    const { text, missing } = composeSections(sliceSections(sample), ['1', '1-B', '99']);
    expect(text.match(/trans/g)).toHaveLength(1);
    expect(missing).toEqual(['99']);
  });
});

describe('slugs', () => {
  it('derives series and episode folders', () => {
    expect(serieSlug('Clínicas dentales')).toBe('clinicas-dentales');
    expect(serieSlug('Cajas, financieras y cooperativas')).toBe('cajas');
    expect(episodeSlug('La llamada que nadie contestó')).toBe('episodio-01-la-llamada-que-nadie');
    expect(episodeSlug('¿Cuántos autos esperan?')).toBe('episodio-01-cuantos-autos-esperan');
  });
});

// The real Robles.AI playbook, when this repo sits next to a robles.ai clone.
const social = path.resolve(__dirname, '../../../robles.ai/creative/social');
const playbook = path.join(social, 'playbook');
const hasPlaybook = fs.existsSync(path.join(playbook, 'PROMPT_MAESTRO_VIDEO.md'));

describe.skipIf(!hasPlaybook)('Robles.AI playbook', () => {
  it('has every section the step map asks for', () => {
    const sections = sliceSections(fs.readFileSync(path.join(playbook, 'PROMPT_MAESTRO_VIDEO.md'), 'utf8'));
    const ids = [...preset.always, ...Object.values(preset.sections).flat()];
    expect(composeSections(sections, ids).missing).toEqual([]);
  });
});
