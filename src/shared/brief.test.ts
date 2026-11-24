import { describe, expect, it } from 'vitest';
import { adReference, parseBrief, scriptReference } from './brief';

const CASE = `## 9. Centros de estética y dermatología — Voz con IA: «Nadie escucha el audio de 3 minutos»

- **Demo:** \`/try-tts\` (Narrador de contenido) · **s=** — · **Slug:** \`centros-de-estetica-y-dermatologia\` · **utm_content:** \`voz-de-tu-marca\`
- **Gancho:** Milagros grabándose diez veces el mismo mensaje con el celular; se traba, vuelve a empezar.
- **Antes:** las indicaciones de antes y después de cada tratamiento se explican de palabra y se olvidan.
- **Después:** pega el texto de cuidados, elige voz y estilo, y obtiene la narración con
  subtítulos lista para su web y sus videos; ella revisa el texto antes de publicar.
- **Personajes:** *Milagros*, coordinadora, 28, pelo largo ondulado, uniforme blanco ·
  *Daniela*, clienta, 35, bob castaño, blusa coral.
- **FRASE:** «Tu marca, con su propia voz.» — **PALABRAS_CLAVE:** «propia voz»
- **ETIQUETAS:** «Voz natural» · «Subtítulos listos» · «Tú apruebas el texto»
- Nota: la voz es generada por IA y se dice en pantalla; nada de indicaciones médicas en el texto.`;

describe('brief', () => {
  it('reads the case block', () => {
    const p = parseBrief(CASE);
    expect(p).toMatchObject({ demo: '`/try-tts` (Narrador de contenido)', slug: '`centros-de-estetica-y-dermatologia`', utmContent: '`voz-de-tu-marca`', phrase: '«Tu marca, con su propia voz.»', keywords: '«propia voz»' });
    expect(p.variant).toBeUndefined();
    expect(p.after).toContain('subtítulos lista para su web');
  });

  it('gives the script only the short reference', () => {
    const ref = scriptReference(CASE, { title: 'Nadie escucha el audio de 3 minutos', businessType: 'Centros de estética y dermatología', solution: 'Voz con IA' });
    expect(ref).toContain('**Antes:**');
    expect(ref).toContain('**Después:**');
    for (const gone of ['Personajes', 'Milagros', 'FRASE', 'ETIQUETAS', 'Nota', 'utm_content', 'Gancho']) expect(ref).not.toContain(gone);
  });

  it('gives Publicación the ad data, without the note', () => {
    const ad = adReference(CASE);
    expect(ad).toContain('voz-de-tu-marca');
    expect(ad).toContain('Tu marca, con su propia voz');
    expect(ad).not.toContain('Nota');
    expect(ad).not.toContain('Milagros');
  });

  it('falls back to the summary when the block has no before/after', () => {
    expect(scriptReference('', { title: 'Ep', summary: 'Algo pasa → se resuelve' })).toContain('**De qué trata:** Algo pasa → se resuelve');
  });
});
