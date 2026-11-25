// Render final (steps 8 and 9 of the playbook): the episode's Remotion project. AdFlow prepares it
// (template, standard logo and closing scene, Robly, the episode's images, clips and voices), Claude
// writes the scenes, and AdFlow renders, masters to −14 LUFS and leaves the MP4 in the episode folder.
import fs from 'node:fs';
import path from 'node:path';
import type { Playbook } from '@shared/types';
import { runCli, startCli } from './proc';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { getDataDir, resolveIn } from './store';

/** The playbook's templates live next to its master prompt (creative/social/playbook/ in robles.ai). */
const templatesDir = (pb: Playbook) => path.dirname(resolveIn(pb, pb.masterPrompt));

export const remotionDir = (episodeDir: string) => path.join(episodeDir, 'remotion');

const isProject = (p: string) => fs.existsSync(path.join(p, 'src', 'Root.tsx')) && fs.existsSync(path.join(p, 'package.json'));

function copyDir(a: string, b: string, keep: (e: fs.Dirent, rel: string) => boolean = () => true, rel = ''): void {
  fs.mkdirSync(b, { recursive: true });
  for (const e of fs.readdirSync(a, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (!keep(e, r)) continue;
    if (e.isDirectory()) copyDir(path.join(a, e.name), path.join(b, e.name), keep, r);
    else fs.copyFileSync(path.join(a, e.name), path.join(b, e.name));
  }
}

/** The newest Remotion project of another episode (same series first), or the playbook's template. */
function projectSource(pb: Playbook, episodeDir: string, serie: string): { dir: string; label: string } {
  const root = resolveIn(pb, pb.episodesRoot);
  const found: { p: string; same: boolean; t: number }[] = [];
  if (fs.existsSync(root)) {
    for (const s of fs.readdirSync(root, { withFileTypes: true })) {
      if (!s.isDirectory()) continue;
      for (const e of fs.readdirSync(path.join(root, s.name), { withFileTypes: true })) {
        const p = path.join(root, s.name, e.name, 'remotion');
        if (!e.isDirectory() || path.join(root, s.name, e.name) === episodeDir || !isProject(p)) continue;
        found.push({ p, same: s.name === serie, t: fs.statSync(path.join(p, 'src', 'Root.tsx')).mtimeMs });
      }
    }
  }
  found.sort((a, b) => Number(b.same) - Number(a.same) || b.t - a.t);
  if (found[0]) return { dir: found[0].p, label: `el proyecto de ${path.basename(path.dirname(found[0].p))}` };
  return { dir: path.join(templatesDir(pb), 'plantilla-proyecto'), label: 'la plantilla del playbook' };
}

const MEDIA = /\.(png|jpe?g|webp|mp4|mov|webm|wav|mp3)$/i;

/** Copies what changes on every episode (and every re-render): its images, clips, voices and music. */
function syncMaterial(episodeDir: string, project: string): void {
  const pub = path.join(project, 'public');
  const pairs: [string, string][] = [
    ['images-9x16', 'escenas'],
    ['video', 'clips'],
    ['voces', 'voz'],
    ['musica', 'musica'],
  ];
  for (const [from, to] of pairs) {
    const src = path.join(episodeDir, from);
    if (!fs.existsSync(src)) continue;
    fs.mkdirSync(path.join(pub, to), { recursive: true });
    for (const f of fs.readdirSync(src)) {
      if (!MEDIA.test(f)) continue;
      const a = path.join(src, f);
      const b = path.join(pub, to, f);
      if (!fs.existsSync(b) || fs.statSync(b).mtimeMs < fs.statSync(a).mtimeMs) fs.copyFileSync(a, b);
    }
  }
}

/**
 * Remotion is installed once per set of versions (the hash of package-lock.json) in AdFlow's storage
 * and every episode project links to it, so only the first episode waits for the install.
 */
async function linkRuntime(project: string, log: (text: string) => void, signal?: AbortSignal): Promise<void> {
  const lockFile = ['package-lock.json', 'package.json'].map((f) => path.join(project, f)).find((f) => fs.existsSync(f))!;
  const key = createHash('sha256').update(fs.readFileSync(lockFile)).digest('hex').slice(0, 12);
  const runtime = path.join(getDataDir(), 'remotion', key);
  if (!fs.existsSync(path.join(runtime, 'node_modules', 'remotion'))) {
    log('Instala Remotion (solo la primera vez)');
    fs.mkdirSync(runtime, { recursive: true });
    for (const f of ['package.json', 'package-lock.json']) if (fs.existsSync(path.join(project, f))) fs.copyFileSync(path.join(project, f), path.join(runtime, f));
    const lock = fs.existsSync(path.join(runtime, 'package-lock.json'));
    const r = await runCli('npm', [lock ? 'ci' : 'install', '--no-audit', '--no-fund'], { cwd: runtime, timeoutMs: 15 * 60_000, signal });
    if (r.code !== 0) throw new Error(`npm ${lock ? 'ci' : 'install'} falló: ${(r.stderr || r.stdout).trim().slice(-600)}`);
  }
  const link = path.join(project, 'node_modules');
  const target = path.join(runtime, 'node_modules');
  let current: string | null = null;
  try {
    current = fs.realpathSync(link);
  } catch {
    /* no link yet */
  }
  if (current && path.resolve(current) === path.resolve(target)) return;
  // A link to other versions is removed without touching what it points to; a real folder left by an
  // older install is deleted.
  const st = fs.lstatSync(link, { throwIfNoEntry: false });
  if (st?.isSymbolicLink()) fs.rmdirSync(link);
  else if (st) fs.rmSync(link, { recursive: true, force: true });
  fs.symlinkSync(target, link, 'junction');
}

export interface PrepareResult {
  dir: string;
  /** Where the code came from (template or another episode), when it was created now. */
  createdFrom?: string;
}

/** Creates (once) and updates the episode's Remotion project. Installs its packages the first time. */
export async function prepareProject(
  pb: Playbook,
  episodeDir: string,
  serie: string,
  log: (text: string) => void,
  signal?: AbortSignal,
): Promise<PrepareResult> {
  const dest = remotionDir(episodeDir);
  let createdFrom: string | undefined;
  if (!isProject(dest)) {
    const src = projectSource(pb, episodeDir, serie);
    if (!isProject(src.dir)) throw new Error('No se encontró la plantilla de Remotion en el playbook. Actualízalo desde Ajustes.');
    log(`Crea el proyecto Remotion desde ${src.label}`);
    fs.mkdirSync(dest, { recursive: true });
    for (const f of ['package.json', 'package-lock.json', 'tsconfig.json']) {
      if (fs.existsSync(path.join(src.dir, f))) fs.copyFileSync(path.join(src.dir, f), path.join(dest, f));
    }
    copyDir(path.join(src.dir, 'src'), path.join(dest, 'src'));
    // Another episode's code without its material.
    if (fs.existsSync(path.join(src.dir, 'public'))) {
      copyDir(path.join(src.dir, 'public'), path.join(dest, 'public'), (e, rel) => {
        const top = rel.split('/')[0];
        return !['clips', 'voz', 'musica', 'escenas'].includes(top) && !(e.isFile() && /^escena_\d+\./i.test(e.name));
      });
    }
    const pkgFile = path.join(dest, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
    pkg.name = `${serie}-${path.basename(episodeDir)}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    fs.writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`);
    createdFrom = src.label;
  }

  // The standard logo and closing scene, and the official Robly: always the playbook's version.
  const social = templatesDir(pb);
  for (const [dir, files] of [
    ['plantilla-logo', ['EscenaLogo.tsx', 'PuenteLogo.tsx']],
    ['plantilla-final', ['EscenaFinal.tsx']],
  ] as const) {
    const from = path.join(social, dir);
    if (!fs.existsSync(from)) continue;
    copyDir(from, path.join(dest, 'public', dir), (e) => e.isDirectory() || /\.(wav|svg|json)$/i.test(e.name));
    for (const f of files) if (fs.existsSync(path.join(from, f))) fs.copyFileSync(path.join(from, f), path.join(dest, 'src', f));
  }
  const robly = resolveIn(pb, 'public/robly-avatar');
  if (fs.existsSync(robly)) for (const f of fs.readdirSync(robly).filter((x) => x.endsWith('.svg'))) fs.copyFileSync(path.join(robly, f), path.join(dest, 'public', f));
  for (const d of ['clips', 'voz', 'musica', 'sfx', 'escenas']) fs.mkdirSync(path.join(dest, 'public', d), { recursive: true });

  // Synthesized sound effects, if the project has none (needs Python; optional).
  const sfx = path.join(dest, 'public', 'sfx');
  const tool = path.join(resolveIn(pb, pb.toolsDir), 'efectos_sintetizados.py');
  if (!fs.readdirSync(sfx).some((f) => f.endsWith('.wav')) && fs.existsSync(tool)) {
    log('Sintetiza los efectos de sonido');
    const r = await runCli('python', [tool, sfx], { timeoutMs: 120_000, shell: false, signal });
    if (r.code !== 0) log('No se pudieron generar los efectos de sonido porque falta Python. El video se renderizará sin ellos.');
  }

  syncMaterial(episodeDir, dest);

  await linkRuntime(dest, log, signal);
  return { dir: dest, createdFrom };
}

/** Length of a media file in seconds (Remotion's own ffprobe, so nothing else is needed). */
export async function mediaDuration(project: string, file: string): Promise<number | null> {
  const r = await runCli('npx', ['remotion', 'ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], {
    cwd: project,
    timeoutMs: 60_000,
  });
  const n = Number.parseFloat(r.stdout.trim());
  return Number.isFinite(n) ? n : null;
}

/** What Claude gets to know about the material: files and lengths, written next to the project. */
export async function writeMaterialList(project: string): Promise<string> {
  const pub = path.join(project, 'public');
  const lines: string[] = [];
  for (const [dir, label] of [
    ['escenas', 'Imágenes de las escenas'],
    ['clips', 'Clips'],
    ['voz', 'Voces del narrador'],
    ['musica', 'Música'],
  ] as const) {
    const abs = path.join(pub, dir);
    const files = fs.existsSync(abs) ? fs.readdirSync(abs).filter((f) => MEDIA.test(f)).sort() : [];
    lines.push(`## ${label} (public/${dir}/)`);
    if (!files.length) lines.push('- (ninguno)');
    for (const f of files) {
      const d = /\.(png|jpe?g|webp)$/i.test(f) ? null : await mediaDuration(project, path.join(abs, f));
      lines.push(`- ${dir}/${f}${d !== null ? ` · ${d.toFixed(2)} s` : ''}`);
    }
    lines.push('');
  }
  const text = `# Material del episodio\n\nUsa estos archivos con staticFile('<carpeta>/<archivo>').\n\n${lines.join('\n')}`;
  fs.writeFileSync(path.join(project, 'MATERIAL.md'), text, 'utf8');
  return text;
}

/**
 * Renders the composition "Video" (the template's render script). Reports progress as it goes.
 * `parallel` is how many renders the queue lets run at once: with more than one, each gets an equal
 * share of the CPU threads (Remotion alone takes half of them per render, and two would fight).
 */
export function renderVideo(
  project: string,
  onProgress: (pct: number) => void,
  signal?: AbortSignal,
  parallel = 1,
): Promise<{ ok: boolean; file: string; error?: string }> {
  const out = path.join(project, 'out', 'video.mp4');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const args = ['remotion', 'render', 'src/index.ts', 'Video', 'out/video.mp4', '--scale=1.5', '--crf=19'];
  if (parallel > 1) args.push(`--concurrency=${Math.max(1, Math.floor(os.availableParallelism() / parallel))}`);
  return new Promise((resolve) => {
    const child = startCli('npx', args, { cwd: project });
    let tail = '';
    let last = -10;
    const onData = (d: Buffer) => {
      const s = String(d);
      tail = (tail + s).slice(-4000);
      const m = /Rendered (\d+)\/(\d+)/g;
      let x: RegExpExecArray | null;
      while ((x = m.exec(s))) {
        const pct = Math.round((Number(x[1]) / Number(x[2])) * 100);
        if (pct >= last + 10) {
          last = pct;
          onProgress(pct);
        }
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    const abort = () => child.kill();
    signal?.addEventListener('abort', abort);
    child.on('close', (code) => {
      signal?.removeEventListener('abort', abort);
      const ok = code === 0 && fs.existsSync(out);
      resolve({ ok, file: out, error: ok ? undefined : tail.trim().split('\n').slice(-25).join('\n') || `Remotion terminó con código ${code}` });
    });
  });
}

/** Brings the mix to −14 LUFS with the playbook's tool and puts it back on the video. Needs Python. */
export async function masterAudio(pb: Playbook, project: string, video: string, out: string, signal?: AbortSignal): Promise<{ ok: boolean; note?: string }> {
  const tool = path.join(resolveIn(pb, pb.toolsDir), 'master_lufs.py');
  if (!fs.existsSync(tool)) return { ok: false, note: 'sin herramienta de masterización en el playbook' };
  const tmp = path.join(project, 'out');
  const raw = path.join(tmp, 'mezcla.wav');
  const mastered = path.join(tmp, 'mezcla-master.wav');
  const ff = (args: string[]) => runCli('npx', ['remotion', 'ffmpeg', '-y', ...args], { cwd: project, timeoutMs: 10 * 60_000, signal });
  if ((await ff(['-i', video, '-vn', '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le', raw])).code !== 0) return { ok: false, note: 'no se pudo extraer el audio' };
  const py = await runCli('python', [tool, raw, mastered], { timeoutMs: 10 * 60_000, shell: false, signal });
  if (py.code !== 0) return { ok: false, note: 'falta Python para masterizar' };
  const join = await ff(['-i', video, '-i', mastered, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out]);
  return join.code === 0 ? { ok: true } : { ok: false, note: 'no se pudo unir el audio masterizado' };
}
