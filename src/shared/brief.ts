// What each step reads about an episode. The case block of the catalog (or the admin) has more than
// the script needs: the script gets only a short reference (what problem, what solution, before and
// after) and creates the rest — hook, characters, scenes — with the master prompt. The ad's data
// (phrase, tags, link) goes only to Publicación. Characters and notes are not passed on.

export interface BriefParts {
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
  [/^demo$/i, 'demo'],
  [/^s=$/i, 'variant'],
  [/^slug$/i, 'slug'],
  [/^utm_content$/i, 'utmContent'],
  [/^antes$/i, 'before'],
  [/^despu[eé]s$/i, 'after'],
  [/^frase$/i, 'phrase'],
  [/^palabras_clave$/i, 'keywords'],
  [/^etiquetas$/i, 'tags'],
];

const clean = (s: string) => s.replace(/\s+/g, ' ').replace(/^[\s—–-]+$/, '').trim();

/** Pure: reads the "- **Label:** value" bullets of a case block (values may span several lines). */
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
  /** Short description (the admin's summary), used when the block has no before/after. */
  summary?: string;
}

/** The short reference the script (and every production step) gets. */
export function scriptReference(raw: string, ep: EpisodeRef): string {
  const p = parseBrief(raw);
  const lines = [`## «${ep.title}»${ep.businessType ? ` — ${ep.businessType}` : ''}`];
  const solution = [ep.solution, p.demo && `demo ${p.demo}`].filter(Boolean).join(' · ');
  if (solution) lines.push(`- **Solución:** ${solution}`);
  if (p.before) lines.push(`- **Antes:** ${p.before}`);
  if (p.after) lines.push(`- **Después:** ${p.after}`);
  if (!p.before && !p.after) {
    const fallback = ep.summary || raw.trim();
    if (fallback) lines.push(`- **De qué trata:** ${clean(fallback)}`);
  }
  return lines.join('\n');
}

/** What only Publicación needs: the ad's phrase and tags, and the data of its link. */
export function adReference(raw: string): string {
  const p = parseBrief(raw);
  const rows: [string, string | undefined][] = [
    ['Demo', p.demo],
    ['Variante de la landing (s=)', p.variant],
    ['Tipo de negocio en el enlace (i=)', p.slug],
    ['utm_content', p.utmContent],
    ['FRASE', p.phrase],
    ['PALABRAS_CLAVE', p.keywords],
    ['ETIQUETAS', p.tags],
  ];
  const lines = rows.filter(([, v]) => v).map(([k, v]) => `- **${k}:** ${v}`);
  return lines.length ? `## Datos del anuncio\n${lines.join('\n')}` : '';
}
