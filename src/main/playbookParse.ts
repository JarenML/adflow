// Pure parsers for the playbook markdown files (no file system access, so they are testable).

export interface Section {
  id: string;
  title: string;
  text: string;
}

/**
 * Splits the master prompt into addressable sections:
 * - `intro`: everything before the first `## ` heading.
 * - `N`: a `## N. Title` section, with its `###` subsections, but without its `**Paso N.**` blocks.
 * - `N-X`: a `### N-X. Title` or `### X. Title` (then id is `N-X`) subsection.
 * - `pasoN`: a `**Paso N. ...**` block inside the pipeline section.
 */
export function sliceSections(md: string): Map<string, Section> {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = new Map<string, Section>();
  let top: { id: string; title: string; lines: string[] } | null = { id: 'intro', title: 'Introducción', lines: [] };
  let sub: { id: string; title: string; lines: string[] } | null = null;
  let paso: { id: string; title: string; lines: string[] } | null = null;

  const flush = (s: { id: string; title: string; lines: string[] } | null) => {
    if (s) out.set(s.id, { id: s.id, title: s.title, text: s.lines.join('\n').trim() });
  };

  for (const line of lines) {
    const h2 = /^## (\d+)\.\s*(.*)$/.exec(line);
    const h3 = /^### ([\w-]+)\.\s*(.*)$/.exec(line);
    const p = /^\*\*Paso (\d+)\.\s*([^*]*)\*\*/.exec(line);
    if (h2) {
      flush(paso);
      flush(sub);
      flush(top);
      paso = sub = null;
      top = { id: h2[1], title: h2[2].trim(), lines: [line] };
      continue;
    }
    if (h3 && top) {
      flush(paso);
      flush(sub);
      paso = null;
      const raw = h3[1];
      const id = raw.includes('-') ? raw : `${top.id}-${raw}`;
      sub = { id, title: h3[2].trim(), lines: [line] };
      top.lines.push(line);
      continue;
    }
    if (p) {
      flush(paso);
      paso = { id: `paso${p[1]}`, title: p[2].trim(), lines: [line] };
      continue;
    }
    if (paso) paso.lines.push(line);
    else {
      top?.lines.push(line);
      sub?.lines.push(line);
    }
  }
  flush(paso);
  flush(sub);
  flush(top);
  return out;
}

/** Joins the requested sections, skipping subsections whose parent is already included. */
export function composeSections(sections: Map<string, Section>, ids: string[]): { text: string; missing: string[] } {
  const wanted = [...new Set(ids)];
  const missing = wanted.filter((id) => !sections.has(id));
  const parts = wanted
    .filter((id) => sections.has(id))
    .filter((id) => {
      const parent = id.includes('-') ? id.split('-')[0] : null;
      return !(parent && wanted.includes(parent));
    })
    .map((id) => sections.get(id)!.text);
  return { text: parts.join('\n\n---\n\n'), missing };
}

export function slugify(s: string, maxWords = 6): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .trim()
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, maxWords)
    .join('-');
}

/** Folder name of a series from its business type ("Clínicas dentales" → "clinicas-dentales"). */
export function serieSlug(businessType: string): string {
  return slugify(businessType.split(/,| y /)[0], 3);
}

export function episodeSlug(title: string, n = 1): string {
  return `episodio-${String(n).padStart(2, '0')}-${slugify(title.replace(/[¿?¡!]/g, ''), 4)}`;
}
