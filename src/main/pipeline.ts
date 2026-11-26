// The orchestrator: creates episodes and runs each pipeline step through the work queue.
// Every step ends in "review": the person approves it (or asks for changes) before the next one.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  ActivityEvent,
  ClipCandidate,
  ClipItem,
  EpisodeState,
  ImageItem,
  LibraryItem,
  NarrationLine,
  PipelineAction,
  Publication,
  RenderReport,
  QueueSnapshot,
  StepId,
} from '@shared/types';
import { clampRenders, STEP_IDS } from '@shared/types';
import {
  imagePromptsSchema,
  isClipScene,
  longClipProblems,
  sceneKind,
  sceneNarration,
  scriptSchema,
  videoPromptsSchema,
  type Script,
} from '@shared/schemas';
import { BRAIN_FILE_TOOLS, onBrainUsage, runBrain, type BrainEvent } from './brain/claudeCli';
import { masterAudio, mediaDuration, prepareProject, renderVideo, writeMaterialList } from './render';
import * as P from './brain/prompts';
import { episodeSlug, serieSlug } from './playbookParse';
import { stepContext } from './playbook';
import { getSource } from './sources';
import { ensureTeamPlaybook } from './teamPlaybook';
import { toTeamStatus } from '@shared/progress';
import { adReference, scriptReference } from '@shared/brief';
import { generateWithCodex } from './providers/codexImage';
import { provider, SECRET_LABELS } from './providers/registry';
import { elevenClip, elevenMusic, elevenUsedCredits } from './providers/elevenlabs';
import { audioMusicFile, buildMusicPlan, MUSIC_CLAUDE, MUSIC_ELEVENLABS, MUSIC_FILE, MUSIC_TIMES_FILE, musicCredits, musicPlanKey, parseMusicTimes } from '@shared/music';
import { runCli } from './proc';
import { DEFAULT_HEYGEN_CREDIT_LIMIT, DEFAULT_VOICE_CREDIT_LIMIT, heygenMaxCredits, lineCredits, planHeygenRun, planVoiceRun } from '@shared/voiceCredits';
import { downloadClip, mcpClip } from './providers/elevenlabsMcp';
import { CLIP_S, DEFAULT_VIDEO_MODEL, videoModel, videoModelFor } from '@shared/videoModels';
import { heygenSpeech } from './providers/heygenMcp';
import { synthesize } from './providers/voices';
import { WorkQueue } from './queue';
import { isStale, needsTake, parseTakes, TAKES_FILE, type TakeRecord } from '@shared/voiceTakes';
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

/** API keys saved in Settings (loaded lazily: secrets need Electron's safeStorage). */
function keys(): Record<string, string> {
  try {
    return (require('./secrets') as typeof import('./secrets')).getSecrets();
  } catch {
    return {};
  }
}

/** Why a provider cannot be used now (not connected, credits not allowed, key missing), or null. */
export function providerBlock(providerId: string, allowPaid: boolean, secrets: Record<string, string>): string | null {
  const p = provider(providerId);
  if (!p?.implemented) return `${p?.name ?? providerId} aún no está disponible en AdFlow.`;
  if (p.billing === 'credits' && !allowPaid) return `${p.name} consume créditos. Habilítalo en Ajustes → Proveedores.`;
  if (p.secret && !secrets[p.secret]) return `Falta la ${SECRET_LABELS[p.secret] ?? p.secret} en Ajustes → Proveedores.`;
  return null;
}

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
    // Every Claude run made for an episode (steps, format fixes, clips, voices) lands in its costs.
    onBrainUsage((tag, res) => {
      if (!tag || res.costUsd === undefined) return;
      try {
        this.update(tag.episodeId, (x) =>
          x.costs.push({ at: now(), step: tag.step, provider: 'claude-cli', label: tag.label, usd: res.costUsd, tokens: res.tokens, model: res.model, durationMs: res.durationMs }),
        );
      } catch {
        /* the episode was removed meanwhile */
      }
    });
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
          e.steps[id] = { ...e.steps[id], status: 'error', error: 'Se interrumpió porque AdFlow se cerró.' };
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
    // The team playbook is refreshed now and then; a failed refresh never blocks the list.
    if (settings.episodeSource === 'produccion-redes') await ensureTeamPlaybook().catch(() => undefined);
    const pb = activePlaybook(settings);
    const src = getSource(settings.episodeSource);
    const items = await src.list(pb);
    const locals = this.list();
    const slash = (p: string) => p.replace(/\\/g, '/');
    return items.map((i) => {
      const local =
        locals.find((e) => e.source?.id === src.id && e.source.episodeId === i.id) ??
        // Same episode folder, here or in a repo (episodes made before the playbook came from the admin).
        (i.folder ? locals.find((e) => this.relFolder(e) === i.folder || slash(e.dir).endsWith(`/${i.folder}`)) : undefined) ??
        // Same case and title, made with no source or with another one (e.g. the local files before the admin).
        locals.find((e) => e.source?.id !== src.id && e.caseNumber === i.caseNumber && e.title === i.title);
      // The link follows the active source, so its progress is reported there.
      if (local && (local.source?.id !== src.id || local.source.episodeId !== i.id)) this.update(local.id, (x) => (x.source = { id: src.id, episodeId: i.id }));
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
    if (!e) throw new Error(`No se encontró el episodio ${id}.`);
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

  patch(id: string, patch: Partial<Pick<EpisodeState, 'providers' | 'voice' | 'voiceCreditLimit' | 'heygenCreditLimit' | 'closingVoice' | 'videoConfig' | 'brain'>>): EpisodeState {
    return this.update(id, (e) => Object.assign(e, patch));
  }

  /** What the brain will get about an episode of the active source, before it is created. */
  async sourceBrief(sourceEpisodeId: string): Promise<string> {
    const settings = loadSettings();
    const item = (await this.library()).find((i) => i.id === sourceEpisodeId);
    const raw = await getSource(settings.episodeSource).brief(activePlaybook(settings), sourceEpisodeId);
    return scriptReference(raw, { title: item?.title ?? '', businessType: item?.businessType, solution: item?.solution, summary: item?.summary });
  }

  /** Creates (or opens) the local episode of a source episode and claims it in the source. */
  async createFromSource(sourceEpisodeId: string): Promise<EpisodeState> {
    const item = (await this.library()).find((i) => i.id === sourceEpisodeId);
    if (!item) throw new Error('Este episodio ya no está disponible.');
    if (item.episodeId) return this.get(item.episodeId);
    const settings = loadSettings();
    const pb = activePlaybook(settings);
    // Take it in the source first: if someone else has it, nothing is created here.
    await getSource(item.sourceId).claim(pb, item.id, settings.userName);
    const root = resolveIn(pb, pb.episodesRoot);
    const folder = item.folder ?? `${serieSlug(item.businessType)}/${episodeSlug(item.title)}`;
    const dir = path.join(root, folder);
    fs.mkdirSync(dir, { recursive: true });
    // Someone already approved its script on another computer: start from it.
    if (!fs.existsSync(path.join(dir, 'escenas.json'))) {
      const saved = await getSource(item.sourceId).script?.(pb, item.id).catch(() => null);
      if (saved?.escenas) {
        fs.writeFileSync(path.join(dir, 'guion.md'), saved.guion, 'utf8');
        fs.writeFileSync(path.join(dir, 'escenas.json'), saved.escenas, 'utf8');
      }
    }
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
      e.steps.script = { status: 'review', updatedAt: now(), note: 'Se cargó el guion guardado del episodio. Revísalo y apruébalo para continuar.' };
      e.current = 'script';
    }
    this.dirs.set(e.id, dir);
    saveEpisode(e);
    this.ev.episode(e);
    // The admin hears the exact status right away (e.g. waiting for your review at Preparación).
    getSource(item.sourceId).report(pb, item.id, toTeamStatus(e), settings.userName).catch(() => {});
    return e;
  }

  // ── Actions ───────────────────────────────────────────────────────────────────────────────

  async act(id: string, a: PipelineAction): Promise<unknown> {
    switch (a.type) {
      case 'approve':
        if (a.step === 'voice') {
          const pending = this.narration(id).filter(needsTake);
          if (pending.length) return void this.setStatus(id, 'voice', 'error', { error: voiceProblem(pending) });
        }
        return void this.approve(id, a.step);
      case 'reopen':
        return void this.update(id, (e) => {
          e.steps[a.step] = { ...e.steps[a.step], status: 'review' };
          e.current = a.step;
        });
      case 'cancel':
        return this.queue.cancel(id, a.step);
    }
    // A message to Claude on an approved step keeps it approved (and where the episode was): it runs
    // as working, and if it ends fine the approval comes back instead of «Esperando por ti».
    if (a.type === 'feedback' && this.get(id).steps[a.step].status === 'approved') {
      const current = this.get(id).current;
      const res = await this.run(id, a);
      if (this.get(id).steps[a.step].status === 'review') {
        this.update(id, (e) => {
          e.steps[a.step] = { ...e.steps[a.step], status: 'approved', updatedAt: now(), error: undefined };
          e.current = current;
        });
        if (a.step === 'script') void this.shareScript(id);
      }
      return res;
    }
    return this.run(id, a);
  }

  /** Every action except approve, reopen and cancel. */
  private async run(id: string, a: PipelineAction): Promise<unknown> {
    if (a.step === 'script') {
      if (a.type === 'generate') return this.brainStep(id, 'script', P.scriptPrompt(this.get(id).title), { fresh: true });
      if (a.type === 'regenerate') {
        this.archive(id, 'script', ['guion.md', 'escenas.json']);
        return this.brainStep(id, 'script', P.scriptPrompt(this.get(id).title), { fresh: true });
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
      if (a.type === 'prepare') return this.prepareClips(id);
      if (a.type === 'addClip') return this.addClip(id, a.sceneId);
      if (a.type === 'removeClip') return void this.removeClip(id, a.sceneId);
      if (a.type === 'feedback') return this.brainStep(id, 'videos', P.videoFeedbackPrompt(a.sceneId, a.message));
      if (a.type === 'import') return this.importClip(id, a.sceneId);
      if (a.type === 'generate') return this.generateClips(id, a.sceneIds);
    }
    if (a.step === 'voice') {
      if (a.type === 'generate') return this.generateVoices(id, a.lineIds);
    }
    if (a.step === 'render') {
      if (a.type === 'build') return this.buildRender(id, 'build');
      if (a.type === 'feedback') return this.buildRender(id, 'feedback', a.message);
      if (a.type === 'rerender') return this.buildRender(id, 'rerender');
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
    if (step === 'script') void this.shareScript(id);
    // Approving the images opens Videos with the clips the script decided (tipo real_clip) and their
    // prompts, ready to generate one by one.
    if (step === 'images' && !fs.existsSync(path.join(this.get(id).dir, 'prompts_video.json'))) {
      setTimeout(() => void this.act(id, { step: 'videos', type: 'prepare' }), 0);
    }
    return this.update(id, (e) => {
      e.steps[step] = { ...e.steps[step], status: 'approved', updatedAt: now(), error: undefined };
      const next = STEP_IDS[STEP_IDS.indexOf(step) + 1];
      if (next) {
        if (e.steps[next].status === 'locked') e.steps[next] = { status: 'ready', updatedAt: now() };
        e.current = next;
      }
    });
  }

  /** Keeps the approved script with the team (the admin), so it survives this computer. */
  private async shareScript(id: string): Promise<void> {
    const e = this.get(id);
    const src = e.source ? getSource(e.source.id) : null;
    if (!e.source || !src?.saveScript) return;
    const read = (f: string) => (fs.existsSync(path.join(e.dir, f)) ? fs.readFileSync(path.join(e.dir, f), 'utf8') : null);
    const guion = read('guion.md');
    if (!guion) return;
    try {
      await src.saveScript(activePlaybook(loadSettings()), e.source.episodeId, { guion, escenas: read('escenas.json') });
      this.activity(id, 'script', 'info', 'Guion guardado en el panel de administración');
    } catch (err) {
      this.activity(id, 'script', 'error', `No se pudo guardar el guion en el panel de administración: ${String((err as Error)?.message ?? err)}`);
    }
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

  /** The short reference every step gets; Publicación also gets the data of the ad's link. */
  private async briefFor(id: string, step: StepId): Promise<string> {
    const e = this.get(id);
    const raw = await this.brief(id).catch(() => '');
    const ep = { title: e.title, businessType: e.businessType, solution: e.solution };
    const ref = scriptReference(raw, ep);
    return step === 'publish' ? [ref, adReference(raw, ep)].join('\n\n') : ref;
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
    opts: {
      fresh?: boolean;
      keepWorking?: boolean;
      /** Where Claude works (default: the episode folder). */
      cwd?: string;
      tools?: string[];
      allowedTools?: string[];
    } = {},
  ): Promise<string | undefined> {
    let output: string | undefined;
    this.setStatus(id, step, 'working', { error: undefined });
    this.activity(id, step, 'info', 'En cola para Claude…');
    return this.queue
      .add(id, step, 'brain', `Claude · ${step}`, async (signal) => {
        const settings = loadSettings();
        const pb = activePlaybook(settings);
        const e = this.get(id);
        const caseBlock = await this.briefFor(id, step);
        const ctx = stepContext(pb, step);
        const account = settings.claude.accounts.find((a) => a.id === e.brain.account);
        const onEvent = (b: BrainEvent) => this.activity(id, step, b.kind, b.text);
        const run = (p: string, sessionId?: string) =>
          runBrain({
            cwd: opts.cwd ?? e.dir,
            tools: opts.tools,
            allowedTools: opts.allowedTools,
            prompt: p,
            system: P.systemPrompt({
              episode: e,
              step,
              playbookName: pb.name,
              playbookText: ctx.text,
              playbookDir: pb.rootDir,
              caseBlock,
            }),
            sessionId,
            model: e.brain.model || settings.claude.model,
            effort: settings.claude.effort,
            // Other episodes of the series (continuity) and the playbook's files (templates, Robly, texts).
            addDirs: [...new Set([resolveIn(pb, pb.episodesRoot), pb.rootDir, opts.cwd ? e.dir : ''].filter(Boolean))],
            configDir: account?.configDir,
            signal,
            onEvent,
            usageFor: { episodeId: id, step, label: 'Claude Code' },
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
    if (step === 'script') {
      const bad = check('escenas.json', scriptSchema);
      if (bad) return bad;
      const long = longClipProblems(scriptSchema.parse(readJsonFile<unknown>(path.join(dir, 'escenas.json'))));
      return long.length ? long.join('\n') : null;
    }
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
        clip: scene ? isClipScene(scene) : false,
      };
    });
  }

  private async generateImages(id: string, only?: string[]): Promise<void> {
    const e = this.get(id);
    const prov = e.providers.image;
    const info = provider(prov);
    if (!info?.implemented) {
      this.setStatus(id, 'images', 'error', { error: `${info?.name ?? prov} aún no está disponible en AdFlow.` });
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

  // The script decides which scenes are clips (tipo real_clip). Videos takes exactly those; the
  // brain only writes their prompts. Adding or removing a clip changes the scene's tipo in the script.

  /** Clip scenes of the script that have an image (the clip's first frame), in script order. */
  private clipScenes(id: string): P.ClipScene[] {
    return (this.script(id).script?.escenas ?? [])
      .filter((s) => isClipScene(s) && !!s.imagen)
      .map((s) => {
        const d = (s as { dialogo?: { texto?: string } | null }).dialogo;
        return { id: s.id, image: s.imagen!, dialogue: d?.texto?.trim() || undefined };
      });
  }

  /** Real scenes that stay as an image: they could become a clip. */
  clipCandidates(id: string): ClipCandidate[] {
    const dir = this.get(id).dir;
    return (this.script(id).script?.escenas ?? [])
      .filter((s) => sceneKind(s.tipo) === 'real' && !isClipScene(s) && !!s.imagen)
      .map((s) => {
        const abs = path.join(dir, s.imagen!);
        return { sceneId: s.id, image: s.imagen!, imageUrl: fs.existsSync(abs) ? fileUrl(abs) : undefined, description: s.descripcion };
      });
  }

  private videoPromptsFile = (id: string) => path.join(this.get(id).dir, 'prompts_video.json');

  /** Keeps prompts_video.json to exactly the clip scenes of the script. Returns the ones without a prompt. */
  private syncClipList(id: string): string[] {
    const wanted = this.clipScenes(id).map((s) => s.id);
    const file = this.videoPromptsFile(id);
    const json = readJsonFile<{ clips?: { escena: string }[] }>(file);
    if (!json || !Array.isArray(json.clips)) return wanted;
    const kept = json.clips.filter((c) => wanted.includes(c.escena));
    if (kept.length !== json.clips.length) writeJson(file, { ...json, clips: kept });
    this.update(id, () => {});
    return wanted.filter((w) => !kept.some((c) => c.escena === w));
  }

  /** Writes the prompts of the script's clip scenes (no clips: an empty list, nothing to generate). */
  private async prepareClips(id: string): Promise<void> {
    const scenes = this.clipScenes(id);
    if (!scenes.length) {
      writeJson(this.videoPromptsFile(id), { clips: [] });
      this.activity(id, 'videos', 'info', 'El guion no tiene escenas con clip; todas se mostrarán como imagen con movimiento.');
      this.setStatus(id, 'videos', 'review', { error: undefined, note: 'El guion no lleva clips de video.' });
      return;
    }
    this.activity(id, 'videos', 'info', `Clips del guion: ${scenes.map((s) => s.id).join(', ')}. Claude está escribiendo sus prompts.`);
    await this.brainStep(id, 'videos', P.videosPrompt(scenes), { fresh: true });
    const missing = this.syncClipList(id);
    if (missing.length) this.setStatus(id, 'videos', 'error', { error: `Falta el prompt de ${missing.join(', ')}` });
  }

  /** Changes a scene's tipo in escenas.json (clip ↔ image). */
  private setSceneClip(id: string, sceneId: string, clip: boolean): void {
    const file = path.join(this.get(id).dir, 'escenas.json');
    const json = readJsonFile<{ escenas?: { id: string; tipo: string; motor?: string }[] }>(file);
    const scene = json?.escenas?.find((s) => s.id === sceneId);
    if (!json || !scene) throw new Error(`No se encontró la escena ${sceneId} en el guion.`);
    scene.tipo = clip ? 'real_clip' : 'real_imagen';
    scene.motor = clip ? 'Veo 3.1 Fast 4 s' : 'Remotion: imagen con push-in';
    writeJson(file, json);
  }

  private async addClip(id: string, sceneId: string): Promise<void> {
    this.setSceneClip(id, sceneId, true);
    this.activity(id, 'videos', 'info', `${sceneId} ahora es un clip. Claude está escribiendo su prompt.`);
    const scene = this.clipScenes(id).find((s) => s.id === sceneId);
    if (!scene) return;
    if (!fs.existsSync(this.videoPromptsFile(id))) writeJson(this.videoPromptsFile(id), { clips: [] });
    await this.brainStep(id, 'videos', P.videoAddPrompt(scene), { fresh: true });
    const missing = this.syncClipList(id);
    if (missing.length) this.setStatus(id, 'videos', 'error', { error: `Falta el prompt de ${missing.join(', ')}` });
  }

  private removeClip(id: string, sceneId: string): void {
    this.setSceneClip(id, sceneId, false);
    this.syncClipList(id);
    const state = this.clipState(id);
    delete state[sceneId];
    writeJson(this.clipStateFile(id), state);
    this.activity(id, 'videos', 'info', `${sceneId} ahora es una imagen con movimiento. Su clip anterior, si lo había, se conserva en la carpeta video/.`);
    this.update(id, () => {});
  }

  private clipStateFile(id: string) {
    return path.join(this.get(id).dir, '.adflow', 'clips.json');
  }

  private clipState(id: string): Record<string, { status: ClipItem['status']; error?: string; flowUrl?: string }> {
    return readJsonFile(this.clipStateFile(id)) ?? {};
  }

  private setClipState(id: string, sceneId: string, s: { status: ClipItem['status']; error?: string; flowUrl?: string }) {
    const all = this.clipState(id);
    all[sceneId] = { flowUrl: all[sceneId]?.flowUrl, ...s };
    writeJson(this.clipStateFile(id), all);
    this.ev.episode(this.get(id));
  }

  clips(id: string): ClipItem[] {
    const e = this.get(id);
    const parsed = videoPromptsSchema.safeParse(readJsonFile(path.join(e.dir, 'prompts_video.json')));
    if (!parsed.success) return [];
    const state = this.clipState(id);
    // A "working" left by a closed app (no job in the queue) is not working anymore.
    const busy = this.queue.isBusy(id, 'videos');
    return parsed.data.clips.map((c) => {
      const abs = path.join(e.dir, c.archivo);
      const img = path.join(e.dir, c.imagen);
      const st = state[c.escena];
      const exists = fs.existsSync(abs);
      return {
        status: st?.status === 'working' && busy ? 'working' : st?.status === 'error' ? 'error' : exists ? 'done' : 'pending',
        error: st?.status === 'error' ? st.error : undefined,
        flowUrl: st?.flowUrl,
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
    this.setClipState(id, sceneId, { status: 'done' });
    this.activity(id, 'videos', 'result', `Clip de ${sceneId} importado`);
    this.update(id, () => {});
  }

  /** Generates the clips with the episode's video provider (ElevenLabs API or MCP), one queue job per clip. */
  private async generateClips(id: string, sceneIds?: string[]): Promise<void> {
    const e = this.get(id);
    // Every clip lasts CLIP_S (the script is written for it), whatever an older episode saved.
    const saved = { provider: e.providers.video, model: DEFAULT_VIDEO_MODEL, resolution: '1080p' as const, ...e.videoConfig, durationS: CLIP_S };
    // A model the provider does not offer (Lite through the API) falls back to the default.
    const cfg = { ...saved, model: videoModelFor(saved.provider, saved.model).id };
    const generates = cfg.provider === 'elevenlabs-video' || cfg.provider === 'elevenlabs-mcp';
    const blocked = generates ? providerBlock(cfg.provider, loadSettings().allowPaidProviders, keys()) : 'Este proveedor no permite generar desde AdFlow. Sube el clip manualmente.';
    if (blocked) {
      this.setStatus(id, 'videos', 'error', { error: blocked });
      return;
    }
    // One attempt per image: an image already being generated is never sent again.
    const clips = this.clips(id).filter((c) => (!sceneIds?.length || sceneIds.includes(c.sceneId)) && c.status !== 'working');
    if (!clips.length) return;
    this.setStatus(id, 'videos', 'working', { error: undefined });
    for (const c of clips) this.setClipState(id, c.sceneId, { status: 'working' });
    const failed: string[] = [];
    const archive = (c: ClipItem) => {
      const abs = path.join(e.dir, c.file);
      if (!fs.existsSync(abs)) return;
      const vdir = path.join(path.dirname(abs), 'variantes');
      fs.mkdirSync(vdir, { recursive: true });
      const base = path.basename(abs, path.extname(abs));
      const n = fs.readdirSync(vdir).filter((f) => f.startsWith(`${base}_v`)).length + 1;
      fs.renameSync(abs, path.join(vdir, `${base}_v${n}${path.extname(abs)}`));
    };

    if (cfg.provider === 'elevenlabs-mcp') {
      const settings = loadSettings();
      const account = settings.claude.accounts.find((a) => a.id === e.brain.account);
      await Promise.all(
        clips.map((c) =>
          this.queue.add(id, 'videos', 'clip', `Clip ${c.sceneId} (MCP)`, async (signal) => {
            this.activity(id, 'videos', 'tool', `Generando el clip ${c.sceneId} con ElevenLabs (${videoModel(cfg.model).label})`);
            const res = await mcpClip({
              dir: e.dir,
              sceneId: c.sceneId,
              image: c.image,
              file: c.file,
              prompt: c.prompt,
              videoModel: cfg.model,
              durationS: cfg.durationS,
              resolution: cfg.resolution,
              audio: c.audio,
              flowName: `${e.title} · ${c.sceneId}`,
              configDir: account?.configDir,
              signal,
              onEvent: (b) => this.activity(id, 'videos', b.kind, `${c.sceneId} · ${b.text}`),
              usageFor: { episodeId: id, step: 'videos', label: `Claude · clip ${c.sceneId}` },
            });
            try {
              if (!res.ok || !res.contentUrl) throw new Error(res.error ?? 'El clip no se generó.');
              archive(c);
              await downloadClip(res.contentUrl, path.join(e.dir, c.file), signal);
              this.setClipState(id, c.sceneId, { status: 'done', flowUrl: res.flowUrl });
              this.update(id, (x) =>
                x.costs.push({ at: now(), step: 'videos', provider: 'elevenlabs-mcp', label: `Clip ${c.sceneId}${res.credits ? ` · ${Math.round(res.credits)} créditos` : ''}` }),
              );
              this.activity(id, 'videos', 'result', `Clip ${c.sceneId} listo${res.credits ? ` (${Math.round(res.credits)} créditos)` : ''}`);
            } catch (err) {
              failed.push(c.sceneId);
              const msg = String((err as Error)?.message ?? err);
              this.setClipState(id, c.sceneId, { status: 'error', error: msg, flowUrl: res.flowUrl });
              this.activity(id, 'videos', 'error', `${c.sceneId}: ${msg}`);
            }
          }),
        ),
      );
      this.setStatus(id, 'videos', failed.length ? 'error' : 'review', failed.length ? { error: `No se generó: ${failed.join(', ')}` } : {});
      return;
    }

    await Promise.all(
      clips.map((c) =>
        this.queue.add(id, 'videos', 'clip', `Clip ${c.sceneId}`, async (signal) => {
          this.activity(id, 'videos', 'tool', `Generando el clip ${c.sceneId} con ElevenLabs`);
          try {
            await elevenClip({
              key: keys().elevenlabs,
              image: path.join(e.dir, c.image),
              prompt: c.prompt,
              model: cfg.model,
              durationS: cfg.durationS,
              resolution: cfg.resolution,
              audio: c.audio,
              outFile: path.join(e.dir, c.file),
              signal,
              onStatus: (s) => this.activity(id, 'videos', 'info', `${c.sceneId}: ${s}`),
            });
            this.setClipState(id, c.sceneId, { status: 'done' });
            this.activity(id, 'videos', 'result', `Clip ${c.sceneId} listo`);
          } catch (err) {
            failed.push(c.sceneId);
            const msg = String((err as Error)?.message ?? err);
            this.setClipState(id, c.sceneId, { status: 'error', error: msg });
            this.activity(id, 'videos', 'error', `${c.sceneId}: ${msg}`);
          }
        }),
      ),
    );
    this.setStatus(id, 'videos', failed.length ? 'error' : 'review', failed.length ? { error: `No se generó: ${failed.join(', ')}` } : {});
  }

  // ── Render final ───────────────────────────────────────────────────────────────────────────

  private renderReportFile = (id: string) => path.join(this.get(id).dir, '.adflow', 'render.json');

  renderReport(id: string): RenderReport | null {
    return readJsonFile<RenderReport>(this.renderReportFile(id));
  }

  /**
   * build: prepares the Remotion project, Claude assembles it, AdFlow renders.
   * feedback: Claude applies a change on the same project, then it renders again.
   * rerender: renders the project as it is (after editing it by hand, or new voices or clips).
   */
  private async buildRender(id: string, mode: 'build' | 'feedback' | 'rerender', message?: string): Promise<void> {
    const e = this.get(id);
    const pb = activePlaybook(loadSettings());
    const log = (t: string, kind: ActivityEvent['kind'] = 'tool') => this.activity(id, 'render', kind, t);
    const fail = (error: string) => {
      log(error, 'error');
      this.setStatus(id, 'render', 'error', { error: error.split(/\r?\n/)[0].slice(0, 300) });
    };
    // An old take (the script changed after it) or a missing one never reaches the video.
    const pending = this.narration(id).filter(needsTake);
    if (pending.length) return fail(`${voiceProblem(pending)} Revisa la Voz del narrador antes de renderizar.`);
    this.setStatus(id, 'render', 'working', { error: undefined });

    // 1. The project, with the episode's latest images, clips and voices.
    let project = '';
    let material = '';
    let problem = '';
    await this.queue.add(id, 'render', 'render', 'Proyecto Remotion', async (signal) => {
      try {
        const r = await prepareProject(pb, e.dir, e.serie, (t) => log(t), signal);
        project = r.dir;
        material = await writeMaterialList(r.dir);
      } catch (err) {
        problem = String((err as Error)?.message ?? err);
      }
    });
    if (problem || !project) return fail(problem || 'No se pudo preparar el proyecto Remotion.');

    // 2. Claude assembles (or changes) the scenes. It may check single frames and types.
    const brain = (prompt: string, fresh = false) =>
      this.brainStep(id, 'render', prompt, {
        fresh,
        keepWorking: true,
        cwd: project,
        tools: [...BRAIN_FILE_TOOLS, 'Bash'],
        allowedTools: ['Bash(npx remotion still:*)', 'Bash(npx remotion compositions:*)', 'Bash(npx tsc:*)'],
      });
    const music = await this.renderMusic(e.providers.music);
    if (mode === 'build') await brain(P.renderPrompt(material, music), !e.brain.sessions.render);
    if (mode === 'feedback' && message) await brain(P.renderFeedbackPrompt(message, music));
    if (this.get(id).steps.render.status === 'error') return;

    // 2b. The music chosen in Preparación is enough: if the assembled project does not have it yet
    // (it was made before choosing it, or the choice changed), Claude adds it here, also on a re-render.
    if (this.musicMissing(e, project, music)) {
      log(music.kind === 'none' ? 'Quita la música del montaje (elegiste «Sin música»)' : 'El montaje aún no tiene la música elegida: Claude la agrega', 'info');
      await brain(P.musicAddPrompt(music));
      if (this.get(id).steps.render.status === 'error') return;
    }

    // 2c. The music, now that the timeline exists (ElevenLabs Music or the script Claude wrote).
    const musicProblem = await this.ensureMusic(id, project, (fix) => brain(P.musicFixPrompt(fix)));
    if (musicProblem) return fail(musicProblem);

    // 3. Render; one fix by Claude if it fails.
    const render = async () => {
      let res: Awaited<ReturnType<typeof renderVideo>> = { ok: false, file: '', error: 'No se ejecutó el render.' };
      await this.queue.add(id, 'render', 'render', 'Render del video', async (signal) => {
        log('Renderiza el video (1080×1920)');
        res = await renderVideo(project, (pct) => log(`Render ${pct} %`, 'info'), signal, clampRenders(loadSettings().concurrency.render));
      });
      return res;
    };
    let res = await render();
    if (!res.ok && mode !== 'rerender') {
      log('El render falló. Claude está corrigiendo el error', 'info');
      await brain(P.renderFixPrompt(res.error ?? ''));
      res = await render();
    }
    if (!res.ok) return fail(`El render falló: ${res.error ?? ''}`);

    // 4. Master to −14 LUFS and leave the final MP4 in the episode folder.
    const final = path.join(e.dir, `${e.slug}.mp4`);
    let mastered = false;
    let note: string | undefined;
    await this.queue.add(id, 'render', 'render', 'Masterización', async (signal) => {
      log('Masteriza el audio a −14 LUFS');
      const m = await masterAudio(pb, project, res.file, final, signal);
      mastered = m.ok;
      if (!m.ok) {
        note = `Sin masterizar (${m.note})`;
        fs.copyFileSync(res.file, final);
      }
    });
    const durationS = await mediaDuration(project, final);
    const report: RenderReport = { at: now(), file: path.basename(final), durationS, sizeMB: Math.round((fs.statSync(final).size / 1048576) * 10) / 10, mastered, note };
    writeJson(this.renderReportFile(id), report);
    log(`Video final: ${report.file} · ${durationS?.toFixed(1) ?? '?'} s · ${report.sizeMB} MB${note ? ` · ${note}` : ''}`, 'result');
    this.setStatus(id, 'render', 'review', { note: `Listo: ${report.file}` });
  }

  /** True when the assembled project does not match the music chosen in Preparación. */
  private musicMissing(e: EpisodeState, project: string, music: P.RenderMusic): boolean {
    const audioFile = path.join(project, 'src', 'audio.tsx');
    const audio = fs.existsSync(audioFile) ? fs.readFileSync(audioFile, 'utf8') : '';
    const playing = audioMusicFile(audio);
    const uses = (f: string) => playing === f;
    if (music.kind === 'none') return playing !== null;
    if (music.kind === 'elevenlabs') return !uses(MUSIC_FILE[MUSIC_ELEVENLABS]) || !fs.existsSync(path.join(project, MUSIC_TIMES_FILE));
    return !uses(MUSIC_FILE[MUSIC_CLAUDE]) || !fs.existsSync(path.join(e.dir, 'musica', 'componer.py'));
  }

  /** What the render prompt says about the music of this episode. */
  private async renderMusic(providerId: string): Promise<P.RenderMusic> {
    if (providerId === MUSIC_ELEVENLABS) return { kind: 'elevenlabs' };
    if (providerId !== MUSIC_CLAUDE) return { kind: 'none' };
    const r = await runCli('python', ['-c', 'import numpy'], { timeoutMs: 30_000, shell: false });
    return { kind: 'claude', numpy: r.code === 0 };
  }

  /**
   * Makes the episode's music after Claude assembled the video, and puts it in the Remotion project.
   * ElevenLabs Music follows the timeline Claude wrote (public/musica/tiempos.json); the same plan
   * reuses the track already made, so a re-render costs nothing. «Claude compone» runs the script
   * Claude wrote (../musica/componer.py), with one fix by Claude if it fails. Returns a problem, if any.
   */
  private async ensureMusic(id: string, project: string, fix: (error: string) => Promise<unknown>): Promise<string | null> {
    const e = this.get(id);
    const providerId = e.providers.music;
    if (providerId !== MUSIC_ELEVENLABS && providerId !== MUSIC_CLAUDE) return null;
    const log = (t: string, kind: ActivityEvent['kind'] = 'tool') => this.activity(id, 'render', kind, t);
    const dir = path.join(e.dir, 'musica');
    const file = path.join(dir, MUSIC_FILE[providerId]);
    const toProject = () => {
      const pub = path.join(project, 'public', 'musica');
      fs.mkdirSync(pub, { recursive: true });
      fs.copyFileSync(file, path.join(pub, path.basename(file)));
    };

    if (providerId === MUSIC_ELEVENLABS) {
      const blocked = providerBlock(providerId, loadSettings().allowPaidProviders, keys());
      if (blocked) return blocked;
      const timesFile = path.join(project, MUSIC_TIMES_FILE);
      const times = parseMusicTimes(fs.existsSync(timesFile) ? fs.readFileSync(timesFile, 'utf8') : null);
      if (!times) return 'Claude no dejó los tiempos de la música (public/musica/tiempos.json). Pídele en el chat de Render final que los escriba y vuelve a renderizar.';
      const { plan, totalMs } = buildMusicPlan(times);
      const planFile = path.join(dir, 'plan.json');
      const previous = fs.existsSync(planFile) ? fs.readFileSync(planFile, 'utf8') : null;
      if (fs.existsSync(file) && previous !== null && previous === musicPlanKey(plan)) {
        log('Música: el montaje no cambió, se reutiliza la pista de ElevenLabs (sin créditos)', 'info');
        toProject();
        return null;
      }
      const credits = musicCredits(totalMs);
      const key = keys().elevenlabs;
      let problem: string | null = null;
      await this.queue.add(id, 'render', 'render', 'Música (ElevenLabs)', async (signal) => {
        log(`Genera la música con ElevenLabs Music: ${(totalMs / 1000).toFixed(1)} s en ${plan.sections.length} secciones (${plan.sections.map((s) => s.section_name).join(' · ')}), ≈ ${credits} créditos`);
        const before = await elevenUsedCredits(key).catch(() => null);
        try {
          await elevenMusic(key, plan, file, signal);
        } catch (err) {
          problem = String((err as Error)?.message ?? err);
          return;
        }
        fs.writeFileSync(planFile, musicPlanKey(plan));
        const after = await elevenUsedCredits(key).catch(() => null);
        const real = before !== null && after !== null ? after - before : null;
        log(`Música lista: ${path.basename(file)}${real !== null ? ` · ElevenLabs registra ${real} créditos` : ''}`, 'result');
        this.update(id, (x) => x.costs.push({ at: now(), step: 'render', provider: MUSIC_ELEVENLABS, label: `Música · ${real ?? credits} créditos`, credits: real ?? credits }));
      });
      if (problem) return problem;
      toProject();
      return null;
    }

    // «Claude» (it composes the music): the script Claude wrote while assembling.
    const script = path.join(dir, 'componer.py');
    if (!fs.existsSync(script)) return 'Claude no escribió la música (../musica/componer.py). Pídele en el chat de Render final que la componga y vuelve a renderizar.';
    const compose = async () => {
      let r: { code: number | null; stdout: string; stderr: string } = { code: -1, stdout: '', stderr: '' };
      await this.queue.add(id, 'render', 'render', 'Música (Claude)', async (signal) => {
        log('Genera la música que compuso Claude (python musica/componer.py)');
        fs.rmSync(file, { force: true });
        r = await runCli('python', [script], { cwd: project, timeoutMs: 10 * 60_000, shell: false, signal });
      });
      return r.code === 0 && fs.existsSync(file) ? null : (r.stderr || r.stdout || 'El script no escribió musica/musica.wav.').trim().split(/\r?\n/).slice(-20).join('\n');
    };
    let error = await compose();
    if (error) {
      log('La música falló. Claude está corrigiendo el script', 'info');
      await fix(error);
      error = await compose();
    }
    if (error) return `La música de Claude falló: ${error.split(/\r?\n/).pop()}`;
    log(`Música lista: musica/${path.basename(file)}`, 'result');
    toProject();
    return null;
  }

  // ── Voice ─────────────────────────────────────────────────────────────────────────────────

  narration(id: string): NarrationLine[] {
    const e = this.get(id);
    const scenes = this.script(id).script?.escenas ?? [];
    const takes = this.readTakes(id);
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
      const stale = isStale(l.text, !!file, takes[lineId]);
      lines.push({
        id: lineId,
        sceneId: s.id,
        who: l.who,
        tone: l.tone,
        text: l.text,
        file,
        url: file ? fileUrl(file) : undefined,
        ...(stale ? { stale, recordedText: takes[lineId] } : {}),
      });
    }
    return lines;
  }

  /** What each take says (`voces/textos.json`), to notice when the script changed after it. */
  private readTakes(id: string): TakeRecord {
    const f = path.join(this.get(id).dir, 'voces', TAKES_FILE);
    return parseTakes(fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null);
  }

  /** Records the text a new take says. */
  private recordTake(id: string, lineId: string, text: string): void {
    const dir = path.join(this.get(id).dir, 'voces');
    fs.mkdirSync(dir, { recursive: true });
    const takes = { ...this.readTakes(id), [lineId]: text };
    fs.writeFileSync(path.join(dir, TAKES_FILE), `${JSON.stringify(takes, null, 2)}\n`);
  }

  async previewVoice(id: string, text: string): Promise<{ url?: string; error?: string }> {
    const e = this.get(id);
    if (!e.voice) return { error: 'Elige una voz para continuar.' };
    const blocked = providerBlock(e.voice.provider, loadSettings().allowPaidProviders, keys());
    if (blocked) return { error: blocked };
    if (e.voice.provider === 'heygen-voice') {
      // One line through the HeyGen MCP (one call, never repeated).
      const r = await heygenSpeech({ dir: e.dir, outDir: path.join(e.dir, '.adflow', 'preview'), voiceId: e.voice.voiceId, lines: [{ id: `muestra-${Date.now()}`, text }] });
      const file = Object.values(r.files)[0];
      return file ? { url: fileUrl(file) } : { error: Object.values(r.errors)[0] ?? r.error ?? 'HeyGen no devolvió audio.' };
    }
    const out = path.join(e.dir, '.adflow', 'preview', `muestra-${Date.now()}.wav`);
    const res = await synthesize(e.voice.provider, e.voice.voiceId, text, out, keys());
    return res.ok ? { url: fileUrl(res.file) } : { error: res.error };
  }

  /** The narration through the HeyGen MCP: one Claude run, one call per line, credits measured. */
  private async generateHeygenVoices(id: string, lineIds?: string[]): Promise<void> {
    const e = this.get(id);
    const requested = this.narration(id).filter((l) => !lineIds?.length || lineIds.includes(l.id));
    if (!requested.length) return;
    // The credit limit: only the lines whose characters fit (worst case, ceil(chars / 1,000)) are
    // sent to Claude, and the hook lets it speak only those texts. The rest keep their old take.
    const limit = e.heygenCreditLimit ?? DEFAULT_HEYGEN_CREDIT_LIMIT;
    const plan = planHeygenRun(requested.map((l) => l.text), limit);
    const lines = requested.slice(0, plan.fits);
    const stoppedAt = plan.fits < requested.length ? requested[plan.fits].id : null;
    if (!lines.length) {
      this.setStatus(id, 'voice', 'error', {
        error: `${requested[0].id} superaría el límite de ${limit} crédito(s) premium de HeyGen (hasta ${heygenMaxCredits(requested[0].text.length)}). Aumenta el límite.`,
      });
      return;
    }
    this.setStatus(id, 'voice', 'working', { error: undefined });
    let failed = 0;
    await this.queue.add(id, 'voice', 'voice', `Voces HeyGen (${lines.length})`, async (signal) => {
      this.activity(
        id,
        'voice',
        'info',
        `Límite de esta ejecución: ${limit} crédito(s) premium. ${plan.allowedChars} caracteres caben (como máximo ${heygenMaxCredits(plan.allowedChars)}).${stoppedAt ? ` Se detiene antes de ${stoppedAt}: no se envía.` : ''}`,
      );
      this.activity(id, 'voice', 'tool', `Generando ${lines.length} frase(s) con HeyGen (una solicitud por frase)`);
      const r = await heygenSpeech({
        dir: e.dir,
        outDir: path.join(e.dir, 'voces', '.heygen'),
        voiceId: e.voice!.voiceId,
        lines: lines.map((l) => ({ id: l.id, text: l.text })),
        signal,
        onEvent: (b) => this.activity(id, 'voice', b.kind, b.text),
        usageFor: { episodeId: id, step: 'voice', label: 'Claude · voz (HeyGen)' },
      });
      if (r.error) this.activity(id, 'voice', 'error', r.error);
      for (const l of lines) {
        const file = r.files[l.id];
        if (file) {
          // A new take replaces the old one in either format.
          for (const ext of ['wav', 'mp3']) fs.rmSync(path.join(e.dir, 'voces', `${l.id}.${ext}`), { force: true });
          fs.renameSync(file, path.join(e.dir, 'voces', `${l.id}.mp3`));
          this.recordTake(id, l.id, l.text);
        } else {
          failed++;
          this.activity(id, 'voice', 'error', `${l.id}: ${r.errors[l.id] ?? 'sin audio'}`);
        }
      }
      const spent = r.creditsBefore != null && r.creditsAfter != null ? r.creditsBefore - r.creditsAfter : null;
      this.activity(
        id,
        'voice',
        'result',
        `HeyGen: ${lines.length - failed} de ${lines.length} frases${spent !== null ? ` · créditos premium ${r.creditsBefore} → ${r.creditsAfter} (gastó ${spent})` : ''}.`,
      );
      this.update(id, (x) => x.costs.push({ at: now(), step: 'voice', provider: 'heygen-voice', label: `Voz del narrador (HeyGen)${spent !== null ? ` · ${spent} créditos premium` : ''}` }));
    });
    if (stoppedAt) {
      this.setStatus(id, 'voice', 'error', { error: `Límite de ${limit} crédito(s) premium de HeyGen: se detuvo antes de ${stoppedAt}. Aumenta el límite para generar las frases restantes.` });
      return;
    }
    const missing = this.narration(id).filter(needsTake).length;
    this.setStatus(id, 'voice', missing ? 'error' : 'review', missing ? { error: `${missing} frase(s) sin audio o con el texto cambiado` } : {});
  }

  private async generateVoices(id: string, lineIds?: string[]): Promise<void> {
    const e = this.get(id);
    if (!e.voice) {
      this.setStatus(id, 'voice', 'error', { error: 'Elige una voz para continuar.' });
      return;
    }
    const blocked = providerBlock(e.voice.provider, loadSettings().allowPaidProviders, keys());
    if (blocked) {
      this.setStatus(id, 'voice', 'error', { error: blocked });
      return;
    }
    if (e.voice.provider === 'heygen-voice') return this.generateHeygenVoices(id, lineIds);
    const lines = this.narration(id).filter((l) => !lineIds?.length || lineIds.includes(l.id));
    // ElevenLabs charges per character: the run never passes the episode's credit limit. Each line is
    // checked before it is sent; the first one that would pass the limit stops the run (it and the
    // ones after keep their previous take).
    // The plan is made before anything is sent (in line order), so lines generated in parallel
    // can never pass the limit. A failed call may still be charged: every sent line counts.
    const paid = e.voice.provider === 'elevenlabs';
    const limit = e.voiceCreditLimit ?? DEFAULT_VOICE_CREDIT_LIMIT;
    const plan = paid ? planVoiceRun(lines.map((l) => l.text), limit) : { total: 0, allowed: 0, fits: lines.length };
    const toSend = lines.slice(0, plan.fits);
    const stoppedAt: string | null = plan.fits < lines.length ? lines[plan.fits].id : null;
    this.setStatus(id, 'voice', 'working', { error: undefined });
    const key = keys().elevenlabs;
    const before = paid && key ? await elevenUsedCredits(key).catch(() => null) : null;
    if (paid) {
      this.activity(id, 'voice', 'info', `Límite de esta ejecución: ${limit.toLocaleString('es-PE')} créditos (estimado de todas las frases: ${plan.total.toLocaleString('es-PE')}).`);
      if (stoppedAt) {
        const cost = lineCredits(lines[plan.fits].text);
        this.activity(id, 'voice', 'error', `Se detuvo en ${stoppedAt}: costaría ${cost} créditos y superaría el límite (${plan.allowed + cost} de ${limit}).`);
      }
    }
    // One queue job per line: the episode's voice limit decides how many go at the same time.
    let spent = 0;
    await Promise.all(
      toSend.map((l) =>
        this.queue.add(id, 'voice', 'voice', `Voz ${l.id}`, async (signal) => {
          if (signal.aborted) return;
          this.activity(id, 'voice', 'tool', `Genera ${l.id}${paid ? ` · ${lineCredits(l.text)} créditos` : ''}`);
          // A new take replaces the old one in either format.
          for (const ext of ['wav', 'mp3']) fs.rmSync(path.join(e.dir, 'voces', `${l.id}.${ext}`), { force: true });
          if (paid) spent += lineCredits(l.text);
          const res = await synthesize(e.voice!.provider, e.voice!.voiceId, l.text, path.join(e.dir, 'voces', `${l.id}.wav`), keys());
          if (res.ok) this.recordTake(id, l.id, l.text);
          else this.activity(id, 'voice', 'error', `${l.id}: ${res.error}`);
        }),
      ),
    );
    if (paid && spent) {
      const after = key && before !== null ? await elevenUsedCredits(key).catch(() => null) : null;
      const real = before !== null && after !== null ? after - before : null;
      this.activity(id, 'voice', 'result', `Consumido en esta ejecución: ≈ ${spent.toLocaleString('es-PE')} créditos${real !== null ? ` (ElevenLabs registra ${real.toLocaleString('es-PE')})` : ''} de un límite de ${limit.toLocaleString('es-PE')}.`);
      this.update(id, (x) => x.costs.push({ at: now(), step: 'voice', provider: 'elevenlabs', label: `Voz del narrador · ${real ?? spent} créditos` }));
    }
    const missing = this.narration(id).filter(needsTake).length;
    if (stoppedAt) {
      this.setStatus(id, 'voice', 'error', { error: `Límite de ${limit.toLocaleString('es-PE')} créditos: se detuvo en ${stoppedAt}. Aumenta el límite y vuelve a generar para completar.` });
      return;
    }
    this.setStatus(id, 'voice', missing ? 'error' : 'review', missing ? { error: `${missing} frase(s) sin audio o con el texto cambiado` } : {});
  }
}

/** The voice lines that stop an approval or a render, in a sentence. */
function voiceProblem(lines: NarrationLine[]): string {
  const changed = lines.filter((l) => l.stale).map((l) => l.id);
  const missing = lines.filter((l) => !l.file).map((l) => l.id);
  return [
    changed.length && `El texto cambió en el guion: ${changed.join(', ')}. Vuelve a generar su audio.`,
    missing.length && `Sin audio: ${missing.join(', ')}.`,
  ]
    .filter(Boolean)
    .join(' ');
}
