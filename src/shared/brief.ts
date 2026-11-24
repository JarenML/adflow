// What each step reads about an episode. Since Nov 2026 the admin's episode carries only the
// essentials: title, what it is about, the problem (before) and the solution (after). The brain
// creates the rest — hook, characters, scenes, and for the ad its phrase and tags — with the master
// prompt. The ad's link is built here from the episode (business type → i=, title → utm_content);
// the landing variant (s=) the brain picks from the solution. Briefs of the older, longer detail
// (with demo, phrase, tags…) are still read: their link data wins over the computed one.

export interface BriefParts {
  summary?: string;
  demo?: string;
  variant?: string;
  slug?: string;
  utmContent?: string;
  before?: string;
  after?: string;
  phrase?: string;
  keywords?: string;
  tags?: string;
}

const LABELS: [RegExp, keyof BriefParts][] = [
  [/^de qu[eé] trata$/i, 'summary'],
  [/^demo$/i, 'demo'],
  [/^s=$/i, 'variant'],
  [/^slug$/i, 'slug'],
  [/^utm_content$/i, 'utmContent'],
  [/^antes\b/i, 'before'],
  [/^despu[eé]s\b/i, 'after'],
  [/^frase$/i, 'phrase'],
  [/^palabras_clave$/i, 'keywords'],
  [/^etiquetas$/i, 'tags'],
];

const clean = (s: string) => s.replace(/\s+/g, ' ').replace(/^[\s—–-]+$/, '').trim();
const unquote = (s: string) => s.replace(/`/g, '').trim();

/** Pure: a name as it appears in a link ("Clínicas dentales" → clinicas-dentales), like robles.ai's businessTypeSlug. */
export const linkSlug = (name: string) =>
  name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Pure: reads the "- **Label:** value" bullets of a brief (values may span several lines). */
export function parseBrief(md: string): BriefParts {
  const bullets: string[] = [];
  for (const line of md.replace(/\r\n/g, '\n').split('\n')) {
    if (/^- /.test(line)) bullets.push(line.slice(2));
    else if (/^\s+\S/.test(line) && bullets.length) bullets[bullets.length - 1] += ` ${line.trim()}`;
  }
  const parts: BriefParts = {};
  for (const b of bullets) {
    // One bullet may hold several "**Label:** value" pairs separated by " · ".
    const re = /\*\*([^*]+?)\*\*\s*([\s\S]*?)(?=\s·\s\*\*|\s—\s\*\*|$)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(b))) {
      const label = m[1].replace(/:$/, '').trim();
      const key = LABELS.find(([r]) => r.test(label))?.[1];
      const value = clean(m[2].replace(/^:\s*/, ''));
      if (key && value && !parts[key]) parts[key] = value;
    }
  }
  return parts;
}

export interface EpisodeRef {
  title: string;
  businessType?: string;
  solution?: string;
  /** Short description (the admin's summary), used when the brief does not carry it. */
  summary?: string;
}

/** The short reference the script (and every production step) gets. */
export function scriptReference(raw: string, ep: EpisodeRef): string {
  const p = parseBrief(raw);
  const lines = [`## «${ep.title}»${ep.businessType ? ` — ${ep.businessType}` : ''}`];
  const solution = [ep.solution, p.demo && `demo ${p.demo}`].filter(Boolean).join(' · ');
  if (solution) lines.push(`- **Solución:** ${solution}`);
  const summary = p.summary || ep.summary || (!p.before && !p.after ? raw.trim() : '');
  if (summary) lines.push(`- **De qué trata:** ${clean(summary)}`);
  if (p.before) lines.push(`- **Antes (el problema):** ${p.before}`);
  if (p.after) lines.push(`- **Después (la solución):** ${p.after}`);
  return lines.join('\n');
}

/** A business type that serves any business has no i= (the landing then shows every type). */
const ANY_BUSINESS = /^cualquier\b|^any\b/i;

/** What only Publicación needs: the data of the ad's link (and, in older briefs, its phrase and tags). */
export function adReference(raw: string, ep: EpisodeRef): string {
  const p = parseBrief(raw);
  const slug = p.slug ? unquote(p.slug) : ep.businessType && !ANY_BUSINESS.test(ep.businessType) ? linkSlug(ep.businessType) : '';
  const rows: [string, string | undefined][] = [
    ['Solución', ep.solution],
    ['Demo', p.demo],
    ['Variante de la landing (s=)', p.variant ? unquote(p.variant) : 'elígela según la solución: chatbots, rag, agents, docs o assessment; ninguna si no encaja'],
    ['Tipo de negocio en el enlace (i=)', slug || 'sin i= (sirve para cualquier negocio)'],
    ['utm_content', p.utmContent ? unquote(p.utmContent) : linkSlug(ep.title)],
    ['FRASE', p.phrase],
    ['PALABRAS_CLAVE', p.keywords],
    ['ETIQUETAS', p.tags],
  ];
  const lines = rows.filter(([, v]) => v).map(([k, v]) => `- **${k}:** ${v}`);
  return `## Datos del anuncio\n${lines.join('\n')}`;
}
