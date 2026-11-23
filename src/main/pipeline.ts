// The orchestrator: creates episodes and runs each pipeline step through the work queue.
// Every step ends in "review": the person approves it (or asks for changes) before the next one.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  ActivityEvent,
  ClipItem,
  EpisodeState,
  ImageItem,
  LibraryItem,
  NarrationLine,
  PipelineAction,
  Publication,
  QueueSnapshot,
  StepId,
} from '@shared/types';
import { STEP_IDS } from '@shared/types';
import {
  imagePromptsSchema,
  sceneKind,
  sceneNarration,
  scriptSchema,
  videoPromptsSchema,
  type Script,
} from '@shared/schemas';
import { runBrain, type BrainEvent } from './brain/claudeCli';
import * as P from './brain/prompts';
import { episodeSlug, serieSlug } from './playbookParse';
import { stepContext } from './playbook';
import { getSource } from './sources';
import { toTeamStatus } from '@shared/progress';
import { generateWithCodex } from './providers/codexImage';
import { provider } from './providers/registry';
import { synthesize } from './providers/voices';
import { WorkQueue } from './queue';
import {
  activePlaybook,
  listEpisodeDirs,
  loadEpisode,
  loadSettings,
  newEpisodeSteps,
  resolveIn,
  saveEpisode,
  writeJson,
} from './store';

export interface PipelineEvents {
  episode: (e: EpisodeState) => void;
  activity: (a: ActivityEvent) => void;
  queue: (q: QueueSnapshot) => void;
  pickFile: (title: string, extensions: string[]) => Promise<string | null>;
}

const now = () => new Date().toISOString();

/** URL the renderer can load for a local file (served by the adflow:// protocol). */
export function fileUrl(abs: string): string {
  const v = fs.existsSync(abs) ? Math.round(fs.statSync(abs).mtimeMs) : 0;
  return `adflow://file/${encodeURIComponent(pathToFileURL(abs).href)}?v=${v}`;
}

function readJsonFile<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

export class Pipeline {
  readonly queue: WorkQueue;
  private dirs = new Map<string, string>();

  constructor(private ev: PipelineEvents) {
    const s = loadSettings();
    this.queue = new WorkQueue(s.concurrency, (q) => ev.queue(q));
    for (const dir of listEpisodeDirs()) {
      const e = loadEpisode(dir);
      if (!e) continue;
      this.dirs.set(e.id, dir);
      // A step left "working" by a crash or a closed app goes back to review/ready.
      let changed = false;
      for (const id of STEP_IDS) {
        if (e.steps[id].status === 'working') {
          e.steps[id] = { ...e.steps[id], status: 'error', error: 'Se interrumpió (la app se cerró).' };
          changed = true;
        }
      }
      if (changed) saveEpisode(e);
    }
  }

  // ── Episodes ──────────────────────────────────────────────────────────────────────────────

  /** The episodes of the active source, each linked to its local AdFlow episode when there is one. */
  async library(): Promise<LibraryItem[]> {
    const settings = loadSettings();
    const pb = activePlaybook(settings);
    const src = getSource(settings.episodeSource);
    const items = await src.list(pb);
    const locals = this.list();
    return items.map((i) => {
      const local =
        locals.find((e) => e.source?.id === src.id && e.source.episodeId === i.id) ??
        (i.folder ? locals.find((e) => this.relFolder(e) === i.folder) : undefined) ??
        // Episodes created before sources existed: same case and title, no source yet.
        locals.find((e) => !e.source && e.caseNumber === i.caseNumber && e.title === i.title);
      if (local && !local.source) this.update(local.id, (x) => (x.source = { id: src.id, episodeId: i.id }));
      const progress = local ? toTeamStatus(local) : undefined;
      const status = i.status === 'publicado' ? 'publicado' : (progress?.status ?? i.status);
      return { ...i, sourceId: src.id, episodeId: local?.id, progress, status, publication: local?.publication ?? i.publication };
    });
  }

  private relFolder(e: EpisodeState): string {
    const pb = activePlaybook(loadSettings());
    return path.relative(resolveIn(pb, pb.episodesRoot), e.dir).replace(/\\/g, '/');
  }

  list(): EpisodeState[] {
    return [...this.dirs.values()]
      .map((d) => loadEpisode(d))
      .filter((e): e is EpisodeState => !!e)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  get(id: string): EpisodeState {
    const dir = this.dirs.get(id);
    const e = dir ? loadEpisode(dir) : null;
    if (!e) throw new Error(`No existe el episodio ${id}`);
    return e;
  }

  private update(id: string, fn: (e: EpisodeState) => void): EpisodeState {
    const e = this.get(id);
    const before = JSON.stringify(toTeamStatus(e));
    fn(e);
    saveEpisode(e);
    this.ev.episode(e);
    const after = toTeamStatus(e);
    if (e.source && JSON.stringify(after) !== before) {
      const settings = loadSettings();
      getSource(e.source.id).report(activePlaybook(settings), e.source.episodeId, after, settings.userName).catch(() => {});
    }
    return e;
  }

  patch(id: string, patch: Partial<Pick<EpisodeState, 'providers' | 'voice' | 'closingVoice' | 'videoConfig' | 'brain'>>): EpisodeState {
    return this.update(id, (e) => Object.assign(e, patch));
  }

  /** Creates (or opens) the local episode of a source episode and claims it in the source. */
  async createFromSource(sourceEpisodeId: string): Promise<EpisodeState> {
    const item = (await this.library()).find((i) => i.id === sourceEpisodeId);
    if (!item) throw new Error('Ese episodio ya no está en la fuente.');
    if (item.episodeId) return this.get(item.episodeId);
    const settings = loadSettings();
    const pb = activePlaybook(settings);
    // Take it in the source first: if someone else has it, nothing is created here.
    await getSource(item.sourceId).claim(pb, item.id, settings.userName);
    const root = resolveIn(pb, pb.episodesRoot);
    const folder = item.folder ?? `${serieSlug(item.businessType)}/${episodeSlug(item.title)}`;
    const dir = path.join(root, folder);
    fs.mkdirSync(dir, { recursive: true });
    const [serie, slug] = folder.split('/');
    const e: EpisodeState = {
      id: folder,
      playbookId: pb.id,
      source: { id: item.sourceId, episodeId: item.id },
      title: item.title,
      serie,
      slug,
      dir,
      caseNumber: item.caseNumber,
      businessType: item.businessType,
      solution: item.solution,
      createdAt: now(),
      updatedAt: now(),
      current: 'prep',
      steps: newEpisodeSteps(),
      providers: { ...settings.defaults },
      brain: { account: settings.claude.defaultAccount, model: settings.claude.model, sessions: {} },
      closingVoice: 'narrator',
      costs: [],
      versions: {},
    };
    // An episode made by hand that already has its script starts at the script review.
    if (fs.existsSync(path.join(dir, 'escenas.json'))) {
      e.steps.prep = { status: 'approved', updatedAt: now() };
      e.steps.script = { status: 'review', updatedAt: now(), note: 'Importado de la carpeta del episodio' };
      e.current = 'script';
    }
    this.dirs.set(e.id, dir);
    saveEpisode(e);
    this.ev.episode(e);
    return e;
  }

  // ── Actions ───────────────────────────────────────────────────────────────────────────────

  async act(id: string, a: PipelineAction): Promise<unknown> {
    switch (a.type) {
      case 'approve':
        return void this.approve(id, a.step);
      case 'reopen':
        return void this.update(id, (e) => {
          e.steps[a.step] = { ...e.steps[a.step], status: 'review' };
          e.current = a.step;
        });
      case 'cancel':
        return this.queue.cancel(id, a.step);
    }
    if (a.step === 'script') {
      if (a.type === 'generate') return this.brainStep(id, 'script', P.scriptPrompt(this.get(id).title, this.get(id).closingVoice), { fresh: true });
      if (a.type === 'regenerate') {
        this.archive(id, 'script', ['guion.md', 'escenas.json']);
        return this.brainStep(id, 'script', P.scriptPrompt(this.get(id).title, this.get(id).closingVoice), { fresh: true });
      }
      if (a.type === 'feedback') return this.brainStep(id, 'script', P.scriptFeedbackPrompt(a.message));
    }
    if (a.step === 'images') {
      if (a.type === 'prepare') {
        await this.brainStep(id, 'images', P.imagesPrompt(), { fresh: true, keepWorking: true });
        if (this.get(id).steps.images.status !== 'error') return this.generateImages(id);
        return;
      }
      if (a.type === 'generate') return this.generateImages(id, a.sceneIds);
      if (a.type === 'feedback') {
        const res = await this.brainStep(id, 'images', P.imageFeedbackPrompt(a.sceneId, a.message), { keepWorking: true });
        const scenes = a.sceneId ? [a.sceneId] : /ESCENAS:\s*([\w,\s]+)/.exec(res ?? '')?.[1].split(',').map((s) => s.trim()).filter(Boolean);
        return this.generateImages(id, scenes?.length ? scenes : undefined);
      }
    }
    if (a.step === 'videos') {
      if (a.type === 'prepare') return this.brainStep(id, 'videos', P.videosPrompt(), { fresh: true });
      if (a.type === 'feedback') return this.brainStep(id, 'videos', P.videoFeedbackPrompt(a.sceneId, a.message));
      if (a.type === 'import') return this.importClip(id, a.sceneId);
    }
    if (a.step === 'voice') {
      if (a.type === 'generate') return this.generateVoices(id);
    }
    if (a.step === 'publish') {
      if (a.type === 'adCopy') return this.brainStep(id, 'publish', P.adCopyPrompt(), { fresh: true });
      if (a.type === 'feedback') return this.brainStep(id, 'publish', P.adCopyFeedbackPrompt(a.message));
      if (a.type === 'markPublished') return void this.markPublished(id, a.publication);
      if (a.type === 'unpublish')
        return void this.update(id, (e) => {
          e.publication = undefined;
          e.steps.publish = { ...e.steps.publish, status: 'review', updatedAt: now() };
        });
    }
  }

  private approve(id: string, step: StepId): EpisodeState {
    return this.update(id, (e) => {
      e.steps[step] = { ...e.steps[step], status: 'approved', updatedAt: now(), error: undefined };
      const next = STEP_IDS[STEP_IDS.indexOf(step) + 1];
      if (next) {
        if (e.steps[next].status === 'locked') e.steps[next] = { status: 'ready', updatedAt: now() };
        e.current = next;
      }
    });
  }

  /** The brief of the episode as its source tells it (case, characters, phrase…). */
  private async brief(id: string): Promise<string> {
    const e = this.get(id);
    const pb = activePlaybook(loadSettings());
    let source = e.source;
    if (!source) {
      const match = (await this.library()).find((i) => i.episodeId === id);
      source = match ? { id: match.sourceId, episodeId: match.id } : undefined;
    }
    return source ? getSource(source.id).brief(pb, source.episodeId) : '';
  }

  private markPublished(id: string, publication: Publication): EpisodeState {
    const user = loadSettings().userName;
    return this.update(id, (e) => {
      e.publication = { ...publication, by: publication.by || user || undefined };
      e.steps.publish = { ...e.steps.publish, status: 'approved', updatedAt: now(), error: undefined };
      e.current = 'publish';
    });
  }

  /** The ad text and link Claude wrote for the publish step. */
  adCopy(id: string): string | null {
    const file = path.join(this.get(id).dir, 'anuncio.md');
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  }

  /** Newest MP4 at the top of the episode folder (where the final render goes). */
  finalVideo(id: string): { file: string; url: string } | null {
    const dir = this.get(id).dir;
    const mp4 = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.mp4')) : [];
    const pick = mp4.map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t)[0]?.f;
    return pick ? { file: pick, url: fileUrl(path.join(dir, pick)) } : null;
  }

  private activity(id: string, step: StepId, kind: ActivityEvent['kind'], text: string) {
    const a: ActivityEvent = { episodeId: id, step, at: now(), kind, text };
    const e = this.get(id);
    fs.appendFileSync(path.join(e.dir, '.adflow', 'activity.jsonl'), `${JSON.stringify(a)}\n`);
    this.ev.activity(a);
  }

  recentActivity(id: string, limit = 200): ActivityEvent[] {
    const file = path.join(this.get(id).dir, '.adflow', 'activity.jsonl');
    if (!fs.existsSync(file)) return [];
    return fs
      .readFileSync(file, 'utf8')
      .trim()
      .split('\n')
      .slice(-limit)
      .map((l) => {
        try {
          return JSON.parse(l) as ActivityEvent;
        } catch {
          return null;
        }
      })
      .filter((a): a is ActivityEvent => !!a);
  }

  private setStatus(id: string, step: StepId, status: EpisodeState['steps'][StepId]['status'], extra: { error?: string; note?: string } = {}) {
    this.update(id, (e) => {
      e.steps[step] = { ...e.steps[step], status, updatedAt: now(), ...extra };
      if (status === 'working' || status === 'review') e.current = step;
    });
  }

  private archive(id: string, step: StepId, files: string[]) {
    const e = this.get(id);
    const v = (e.versions[step] ?? 0) + 1;
    const dest = path.join(e.dir, '.adflow', 'versions', `${step}-v${v}`);
    let any = false;
    for (const f of files) {
      const src = path.join(e.dir, f);
      if (fs.existsSync(src)) {
        fs.mkdirSync(dest, { recursive: true });
        fs.copyFileSync(src, path.join(dest, path.basename(f)));
        any = true;
      }
    }
    if (any) this.update(id, (x) => (x.versions[step] = v));
  }

  /** Runs the brain for a step, then validates what it wrote. Returns the brain's final text. */
  private brainStep(
    id: string,
    step: StepId,
    prompt: string,
    opts: { fresh?: boolean; keepWorking?: boolean } = {},
  ): Promise<string | undefined> {
    let output: string | undefined;
    this.setStatus(id, step, 'working', { error: undefined });
    this.activity(id, step, 'info', 'En cola para Claude…');
    return this.queue
      .add(id, step, 'brain', `Claude · ${step}`, async (signal) => {
        const settings = loadSettings();
        const pb = activePlaybook(settings);
        const e = this.get(id);
        const caseBlock = await this.brief(id);
        const ctx = stepContext(pb, step);
        const account = settings.claude.accounts.find((a) => a.id === e.brain.account);
        const onEvent = (b: BrainEvent) => this.activity(id, step, b.kind, b.text);
        const run = (p: string, sessionId?: string) =>
          runBrain({
            cwd: e.dir,
            prompt: p,
            system: P.systemPrompt({
              episode: e,
              step,
              playbookName: pb.name,
              playbookText: ctx.text,
              caseBlock,
            }),
            sessionId,
            model: e.brain.model || settings.claude.model,
            effort: settings.claude.effort,
            addDirs: [resolveIn(pb, pb.episodesRoot)],
            configDir: account?.configDir,
            signal,
            onEvent,
          });

        let res = await run(prompt, opts.fresh ? undefined : e.brain.sessions[step]);
        if (res.ok) {
          const problem = this.validate(id, step);
          if (problem) {
            this.activity(id, step, 'info', 'Corrigiendo el formato…');
            res = await run(P.scriptFixPrompt(problem), res.sessionId);
          }
        }
        output = res.text;
        this.update(id, (x) => {
          if (res.sessionId) x.brain.sessions[step] = res.sessionId;
          if (res.costUsd) x.costs.push({ at: now(), step, provider: 'claude-cli', label: 'Claude Code', usd: res.costUsd });
        });
        const problem = res.ok ? this.validate(id, step) : res.error;
        if (problem) this.setStatus(id, step, 'error', { error: problem });
        else if (!opts.keepWorking) this.setStatus(id, step, 'review', { note: res.text.slice(0, 400) });
      })
      .then(() => output);
  }

  /** Checks the file a step must produce. Returns a problem description or null. */
  private validate(id: string, step: StepId): string | null {
    const dir = this.get(id).dir;
    const check = (file: string, schema: { safeParse: (v: unknown) => { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } } }) => {
      const json = readJsonFile<unknown>(path.join(dir, file));
      if (json === null) return `No se encontró ${file} o no es JSON válido.`;
      const r = schema.safeParse(json);
      return r.success ? null : r.error!.issues.slice(0, 8).map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    };
    if (step === 'script') return check('escenas.json', scriptSchema);
    if (step === 'images') return check('prompts_imagenes.json', imagePromptsSchema);
    if (step === 'videos') return check('prompts_video.json', videoPromptsSchema);
    if (step === 'publish') return fs.existsSync(path.join(dir, 'anuncio.md')) ? null : 'No se encontró anuncio.md.';
    return null;
  }

  // ── Script ────────────────────────────────────────────────────────────────────────────────

  script(id: string): { script: Script | null; guion: string | null; error?: string } {
    const dir = this.get(id).dir;
    const guion = fs.existsSync(path.join(dir, 'guion.md')) ? fs.readFileSync(path.join(dir, 'guion.md'), 'utf8') : null;
    const json = readJsonFile<unknown>(path.join(dir, 'escenas.json'));
    if (!json) return { script: null, guion };
    const r = scriptSchema.safeParse(json);
    return r.success ? { script: r.data, guion } : { script: null, guion, error: r.error.issues[0]?.message };
  }

  // ── Images ────────────────────────────────────────────────────────────────────────────────

  private imageStateFile(id: string) {
    return path.join(this.get(id).dir, '.adflow', 'images.json');
  }

  private imageState(id: string): Record<string, { status: ImageItem['status']; error?: string }> {
    return readJsonFile(this.imageStateFile(id)) ?? {};
  }

  private setImageState(id: string, sceneId: string, s: { status: ImageItem['status']; error?: string }) {
    const all = this.imageState(id);
    all[sceneId] = s;
    writeJson(this.imageStateFile(id), all);
    this.ev.episode(this.get(id));
  }

  images(id: string): ImageItem[] {
    const e = this.get(id);
    const prompts = readJsonFile<unknown>(path.join(e.dir, 'prompts_imagenes.json'));
    const parsed = imagePromptsSchema.safeParse(prompts);
    if (!parsed.success) return [];
    const scenes = new Map((this.script(id).script?.escenas ?? []).map((s) => [s.id, s]));
    const state = this.imageState(id);
    return parsed.data.imagenes.map((img) => {
      const abs = path.join(e.dir, img.archivo);
      const exists = fs.existsSync(abs);
      const st = state[img.escena];
      const scene = scenes.get(img.escena);
      return {
        sceneId: img.escena,
        file: img.archivo,
        prompt: img.prompt,
        references: img.referencias,
        exists,
        url: exists ? fileUrl(abs) : undefined,
        status: st?.status === 'working' ? 'working' : st?.status === 'error' ? 'error' : exists ? 'done' : 'pending',
        error: st?.error,
        description: scene?.descripcion,
        narration: scene ? sceneNarration(scene)?.text : undefined,
      };
    });
  }

  private async generateImages(id: string, only?: string[]): Promise<void> {
    const e = this.get(id);
    const prov = e.providers.image;
    const info = provider(prov);
    if (!info?.implemented) {
      this.setStatus(id, 'images', 'error', { error: `${info?.name ?? prov} todavía no está conectado en AdFlow.` });
      return;
    }
    const list = this.images(id).filter((i) => (only ? only.includes(i.sceneId) : !i.exists || i.status === 'error'));
    if (!list.length) {
      this.setStatus(id, 'images', 'review');
      return;
    }
    this.setStatus(id, 'images', 'working', { error: undefined });
    // Generate in order: an image may use an earlier one as reference.
    const waitFor = new Map<string, Promise<void>>();
    const jobs = list.map((img) => {
      const deps = img.references.map((r) => waitFor.get(r)).filter(Boolean) as Promise<void>[];
      this.setImageState(id, img.sceneId, { status: 'working' });
      const job = Promise.all(deps).then(() =>
        this.queue.add(id, 'images', 'image', `Imagen ${img.sceneId}`, async (signal) => {
          const abs = path.join(e.dir, img.file);
          if (fs.existsSync(abs)) {
            const vdir = path.join(path.dirname(abs), 'variantes');
            fs.mkdirSync(vdir, { recursive: true });
            const base = path.basename(abs, '.png');
            const n = fs.readdirSync(vdir).filter((f) => f.startsWith(`${base}_v`)).length + 1;
            fs.copyFileSync(abs, path.join(vdir, `${base}_v${n}.png`));
          }
          this.activity(id, 'images', 'tool', `Codex genera ${img.file}`);
          const res = await generateWithCodex({ cwd: e.dir, file: img.file, prompt: img.prompt, references: img.references, signal });
          this.setImageState(id, img.sceneId, res.ok ? { status: 'done' } : { status: 'error', error: res.error });
          this.activity(id, 'images', res.ok ? 'result' : 'error', res.ok ? `${img.sceneId} lista` : `${img.sceneId}: ${res.error}`);
          if (res.ok) this.update(id, (x) => x.costs.push({ at: now(), step: 'images', provider: prov, label: `Imagen ${img.sceneId}` }));
        }),
      );
      waitFor.set(img.file, job);
      return job;
    });
    await Promise.all(jobs);
    const failed = this.images(id).filter((i) => i.status === 'error').length;
    this.setStatus(id, 'images', failed ? 'error' : 'review', failed ? { error: `${failed} imagen(es) fallaron` } : {});
  }

  // ── Videos ────────────────────────────────────────────────────────────────────────────────

  clips(id: string): ClipItem[] {
    const e = this.get(id);
    const parsed = videoPromptsSchema.safeParse(readJsonFile(path.join(e.dir, 'prompts_video.json')));
    if (!parsed.success) return [];
    return parsed.data.clips.map((c) => {
      const abs = path.join(e.dir, c.archivo);
      const img = path.join(e.dir, c.imagen);
      return {
        sceneId: c.escena,
        image: c.imagen,
        imageUrl: fs.existsSync(img) ? fileUrl(img) : undefined,
        prompt: c.prompt,
        audio: c.audio,
        durationS: c.duracion_s,
        reason: c.motivo,
        file: c.archivo,
        exists: fs.existsSync(abs),
        url: fs.existsSync(abs) ? fileUrl(abs) : undefined,
      };
    });
  }

  private async importClip(id: string, sceneId: string): Promise<void> {
    const clip = this.clips(id).find((c) => c.sceneId === sceneId);
    if (!clip) return;
    const src = await this.ev.pickFile(`Clip de ${sceneId}`, ['mp4', 'mov', 'webm']);
    if (!src) return;
    const dest = path.join(this.get(id).dir, clip.file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    this.activity(id, 'videos', 'result', `Clip de ${sceneId} importado`);
    this.update(id, () => {});
  }

  // ── Voice ─────────────────────────────────────────────────────────────────────────────────

  narration(id: string): NarrationLine[] {
    const e = this.get(id);
    const scenes = this.script(id).script?.escenas ?? [];
    const lines: NarrationLine[] = [];
    let n = 0;
    for (const s of scenes) {
      // The logo has no voice and the closing line is fixed by the playbook's template.
      if (['logo', 'final'].includes(sceneKind(s.tipo))) continue;
      const l = sceneNarration(s);
      if (!l || !/narrador/i.test(l.who)) continue;
      n++;
      const lineId = `n${String(n).padStart(2, '0')}`;
      const file = ['wav', 'mp3'].map((ext) => path.join(e.dir, 'voces', `${lineId}.${ext}`)).find((f) => fs.existsSync(f));
      lines.push({ id: lineId, sceneId: s.id, who: l.who, tone: l.tone, text: l.text, file, url: file ? fileUrl(file) : undefined });
    }
    return lines;
  }

  async previewVoice(id: string, text: string): Promise<{ url?: string; error?: string }> {
    const e = this.get(id);
    if (!e.voice) return { error: 'Elige una voz primero.' };
    const out = path.join(e.dir, '.adflow', 'preview', `muestra-${Date.now()}.wav`);
    const res = await synthesize(e.voice.provider, e.voice.voiceId, text, out);
    return res.ok ? { url: fileUrl(res.file) } : { error: res.error };
  }

  private async generateVoices(id: string): Promise<void> {
    const e = this.get(id);
    if (!e.voice) {
      this.setStatus(id, 'voice', 'error', { error: 'Elige una voz primero.' });
      return;
    }
    const info = provider(e.voice.provider);
    if (!info?.implemented) {
      this.setStatus(id, 'voice', 'error', { error: `${info?.name ?? e.voice.provider} gasta créditos y todavía está bloqueado.` });
      return;
    }
    const lines = this.narration(id);
    this.setStatus(id, 'voice', 'working', { error: undefined });
    await this.queue.add(id, 'voice', 'render', `Voces (${lines.length})`, async (signal) => {
      for (const l of lines) {
        if (signal.aborted) break;
        this.activity(id, 'voice', 'tool', `Genera ${l.id}`);
        const res = await synthesize(e.voice!.provider, e.voice!.voiceId, l.text, path.join(e.dir, 'voces', `${l.id}.wav`));
        if (!res.ok) this.activity(id, 'voice', 'error', `${l.id}: ${res.error}`);
      }
    });
    const missing = this.narration(id).filter((l) => !l.file).length;
    this.setStatus(id, 'voice', missing ? 'error' : 'review', missing ? { error: `${missing} frase(s) sin audio` } : {});
  }
}
