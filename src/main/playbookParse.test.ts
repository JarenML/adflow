import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildLibrary,
  composeSections,
  episodeSlug,
  parseCases,
  parseTracking,
  serieSlug,
  sliceSections,
} from './playbookParse';
import { ROBLES_SECTIONS } from './store';

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
const hasPlaybook = fs.existsSync(path.join(social, 'PROMPT_MAESTRO_VIDEO.md'));

describe.skipIf(!hasPlaybook)('Robles.AI playbook', () => {
  it('has every section the step map asks for', () => {
    const sections = sliceSections(fs.readFileSync(path.join(social, 'PROMPT_MAESTRO_VIDEO.md'), 'utf8'));
    const ids = [...ROBLES_SECTIONS.always, ...Object.values(ROBLES_SECTIONS.sections).flat()];
    expect(composeSections(sections, ids).missing).toEqual([]);
  });

  it('builds the episode library from the catalog and the tracking table', () => {
    const cases = parseCases(fs.readFileSync(path.join(social, 'PROMPT_MAESTRO_CASOS.md'), 'utf8'));
    const rows = parseTracking(fs.readFileSync(path.join(social, 'SEGUIMIENTO_SERIES.md'), 'utf8'));
    expect(cases.length).toBeGreaterThanOrEqual(12);
    expect(cases.find((c) => c.number === 3)?.title).toBe('La llamada que nadie contestó');
    const lib = buildLibrary(cases, rows);
    const dental = lib.find((i) => i.caseNumber === 3)!;
    expect(dental.produced).toBe(false);
    expect(dental.summary).toContain('Sofía');
    expect(lib.filter((i) => i.caseNumber === 1).length).toBe(2);
  });
});
