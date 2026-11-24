import { describe, expect, it } from 'vitest';
import { adReference, linkSlug, parseBrief, scriptReference } from './brief';

// The brief the admin builds since Nov 2026: only the essentials.
const BRIEF = `## Clínicas dentales · Ep. 01 — Recepcionista IA por teléfono: «La llamada que nadie contestó»

- **De qué trata:** Nadie contesta el teléfono a la hora del almuerzo.
- **Antes (el problema):** Sofía llama para una limpieza de su hijo; nadie contesta.
- **Después (la solución):** la recepcionista IA contesta, agenda y Rosa confirma.`;

// An older, longer brief (with demo, link, phrase and tags).
const OLD = `## 9. Centros de estética y dermatología — Voz con IA: «Nadie escucha el audio de 3 minutos»

- **Demo:** \`/try-tts\` (Narrador de contenido) · **s=** — · **Slug:** \`centros-de-estetica-y-dermatologia\` · **utm_content:** \`voz-de-tu-marca\`
- **Gancho:** Milagros grabándose diez veces el mismo mensaje con el celular.
- **Antes:** las indicaciones se explican de palabra y se olvidan.
- **Después:** pega el texto de cuidados, elige voz y estilo, y obtiene la narración con
  subtítulos lista para su web y sus videos.
- **Personajes:** *Milagros*, coordinadora, 28.
- **FRASE:** «Tu marca, con su propia voz.» — **PALABRAS_CLAVE:** «propia voz»
- **ETIQUETAS:** «Voz natural» · «Subtítulos listos»
- Nota: la voz es generada por IA.`;

const EP = { title: 'La llamada que nadie contestó', businessType: 'Clínicas dentales', solution: 'Recepcionista IA por teléfono' };

describe('brief', () => {
  it('reads the essentials and the older detail', () => {
    expect(parseBrief(BRIEF)).toEqual({
      summary: 'Nadie contesta el teléfono a la hora del almuerzo.',
      before: 'Sofía llama para una limpieza de su hijo; nadie contesta.',
      after: 'la recepcionista IA contesta, agenda y Rosa confirma.',
    });
    const p = parseBrief(OLD);
    expect(p).toMatchObject({ demo: '`/try-tts` (Narrador de contenido)', utmContent: '`voz-de-tu-marca`', phrase: '«Tu marca, con su propia voz.»' });
    expect(p.variant).toBeUndefined();
    expect(p.after).toContain('subtítulos lista para su web');
  });

  it('gives the script what the episode is about, the problem and the solution', () => {
    const ref = scriptReference(BRIEF, EP);
    expect(ref).toContain('- **Solución:** Recepcionista IA por teléfono');
    expect(ref).toContain('- **De qué trata:** Nadie contesta');
    expect(ref).toContain('- **Antes (el problema):** Sofía llama');
    expect(ref).toContain('- **Después (la solución):** la recepcionista IA');
    const old = scriptReference(OLD, { title: 'Nadie escucha el audio de 3 minutos', businessType: 'Centros de estética y dermatología', solution: 'Voz con IA' });
    for (const gone of ['Personajes', 'Milagros', 'FRASE', 'ETIQUETAS', 'Nota', 'utm_content', 'Gancho']) expect(old).not.toContain(gone);
  });

  it('builds the ad link data from the episode', () => {
    const ad = adReference(BRIEF, EP);
    expect(ad).toContain('- **Tipo de negocio en el enlace (i=):** clinicas-dentales');
    expect(ad).toContain('- **utm_content:** la-llamada-que-nadie-contesto');
    expect(ad).toContain('elígela según la solución');
    expect(adReference(BRIEF, { ...EP, businessType: 'Cualquier negocio' })).toContain('sin i=');
    // An older brief keeps its own link data, phrase and tags.
    const old = adReference(OLD, { title: 'Nadie escucha el audio de 3 minutos', businessType: 'Centros de estética y dermatología' });
    expect(old).toContain('- **utm_content:** voz-de-tu-marca');
    expect(old).toContain('Tu marca, con su propia voz');
    expect(old).not.toContain('Milagros');
    expect(linkSlug('  Law Firms & Notaries ')).toBe('law-firms-notaries');
  });

  it('falls back to the summary when the brief has nothing', () => {
    expect(scriptReference('', { title: 'Ep', summary: 'Algo pasa → se resuelve' })).toContain('**De qué trata:** Algo pasa → se resuelve');
  });
});
