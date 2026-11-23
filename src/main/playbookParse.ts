// Pure parsers for the playbook markdown files (no file system access, so they are testable).
import type { SourceEpisode, TeamStatus } from '@shared/types';

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

export interface CaseBlock {
  number: number;
  produced: boolean;
  businessType: string;
  solution: string;
  title: string;
  block: string;
  summary: string;
}

const CASE_HEADING = /^## (?:\[(x| )\] )?(\d+)\. (.+?) — (.+)$/;

export function parseCases(md: string): CaseBlock[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const cases: CaseBlock[] = [];
  let cur: { head: RegExpExecArray; lines: string[] } | null = null;
  const close = () => {
    if (!cur) return;
    const [, mark, num, business, rest] = cur.head;
    const titleMatch = /«(.+?)»/.exec(rest);
    const solution = rest.split(':')[0].replace(/\s*\(.*\)\s*$/, '').trim();
    const body = cur.lines.join('\n');
    const title = titleMatch?.[1] ?? /«(.+?)»/.exec(body)?.[1] ?? solution;
    cases.push({
      number: Number(num),
      produced: mark === 'x' || /producido/i.test(rest),
      businessType: business.trim(),
      solution,
      title,
      block: [cur.head[0], body].join('\n').trim(),
      summary: caseSummary(body),
    });
    cur = null;
  };
  for (const line of lines) {
    const m = CASE_HEADING.exec(line);
    if (m) {
      close();
      cur = { head: m, lines: [] };
    } else if (/^## /.test(line)) {
      close();
    } else if (cur) cur.lines.push(line);
  }
  close();
  return cases;
}

function clean(s: string): string {
  return s.replace(/\*\*/g, '').replace(/`/g, '').replace(/\s+/g, ' ').trim();
}

/** One or two lines that say what the episode is about: the "Antes" and "Después" bullets. */
export function caseSummary(body: string): string {
  const bullet = (label: string) => {
    const m = new RegExp(`- \\*\\*${label}:\\*\\*([\\s\\S]*?)(?=\\n- |$)`).exec(body);
    return m ? clean(m[1]) : '';
  };
  const before = bullet('Antes');
  const after = bullet('Después');
  const short = (s: string) => (s.length > 170 ? `${s.slice(0, 167).replace(/\s+\S*$/, '')}…` : s);
  if (before || after) return [before && short(before), after && short(after)].filter(Boolean).join(' → ');
  const first = /- (.+)/.exec(body)?.[1];
  return first ? short(clean(first)) : '';
}

export interface TrackingRow {
  caseNumber: number;
  businessType: string;
  solution: string;
  episode: string;
  folder?: string;
  step: string;
  status: string;
  published: string;
  notes: string;
}

export function parseTracking(md: string): TrackingRow[] {
  const rows: TrackingRow[] = [];
  for (const line of md.replace(/\r\n/g, '\n').split('\n')) {
    if (!/^\|\s*\d+\s*\|/.test(line)) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 10) continue;
    const folder = cells[4].replace(/`/g, '').replace(/\/$/, '');
    rows.push({
      caseNumber: Number(cells[0]),
      businessType: cells[1],
      solution: cells[2].replace(/\s*\(`.*`\)/, ''),
      episode: cells[3].replace(/[«»]/g, ''),
      folder: folder && folder !== '—' ? folder : undefined,
      step: cells[5],
      status: cells[6],
      published: cells[8],
      notes: cells[9],
    });
  }
  return rows;
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

/** Team status of a tracked row ("✅ Terminado", "📣 Publicado", "0 · Pendiente", "8 · Revisión"…). */
export function rowStatus(r: TrackingRow | undefined, producedInCatalog: boolean): TeamStatus {
  if (!r) return producedInCatalog ? 'terminado' : 'pendiente';
  if (/publicado/i.test(r.step) || (r.published && r.published !== '—' && r.published !== '-')) return 'publicado';
  if (/terminado/i.test(r.step)) return 'terminado';
  if (/pendiente/i.test(r.step)) return 'pendiente';
  return 'en_produccion';
}

/**
 * Episodes of the playbook catalog: one per tracked row, plus every case with no row yet.
 * Ids are stable: the episode folder when the tracking table has one, otherwise case + title.
 */
export function toSourceEpisodes(cases: CaseBlock[], rows: TrackingRow[]): SourceEpisode[] {
  const out: SourceEpisode[] = [];
  for (const c of cases) {
    const own = rows.filter((r) => r.caseNumber === c.number);
    const base = { caseNumber: c.number, businessType: c.businessType, solution: c.solution, summary: c.summary };
    const list = own.length ? own : [undefined];
    for (const r of list) {
      const title = r?.episode || c.title;
      const status = rowStatus(r, c.produced);
      out.push({
        ...base,
        id: r?.folder ? `folder:${r.folder}` : `case:${c.number}:${slugify(title, 5)}`,
        title,
        folder: r?.folder,
        status,
        stepLabel: r && status === 'en_produccion' ? r.step : undefined,
        publication: status === 'publicado' && r?.published && r.published !== '—' ? { network: r.published, date: '' } : undefined,
        notes: r?.notes,
      });
    }
  }
  return out;
}
