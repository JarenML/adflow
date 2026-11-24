// HeyGen voices through the HeyGen MCP of the person's Claude Code (no API key in AdFlow). AdFlow
// cannot call the MCP itself, so Claude does the MCP part with a fixed recipe and writes the result
// to a JSON file that AdFlow reads:
// - the voice catalog (free: listing voices spends nothing), cached for a week;
// - the narration: one create_speech call per line, never repeated (a PreToolUse hook enforces it),
//   with the premium credits read before and after to log what the run really spent.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { VoiceOption } from '@shared/types';
import { runBrain, type BrainEvent } from '../brain/claudeCli';

const HG = 'mcp__heygen__';
const CATALOG_DAYS = 7;

const SYSTEM = `Eres el operador de voces de AdFlow. Solo usas las herramientas de HeyGen que te permiten y escribes
el archivo de resultado que se te pide. No haces preguntas ni generas nada que no se te pida. Escribe en español.`;

interface RawVoice {
  voice_id: string;
  name: string;
  language?: string;
  locale?: string;
  gender?: string;
  mode?: string;
  status?: string;
  preview_audio_url?: string;
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

function toOption(v: RawVoice, own: boolean): VoiceOption {
  return {
    id: v.voice_id,
    name: own ? `${v.name} · tu voz` : v.name,
    // es-MX keeps the accent visible; the filters read the first two letters.
    language: v.locale || v.language || '',
    gender: v.gender || undefined,
    previewUrl: v.preview_audio_url || undefined,
  };
}

interface HeygenCache {
  at: string;
  public: RawVoice[];
  private: RawVoice[];
  /** Voices added by ID (found with get_voice): kept when the catalog is read again. */
  extra?: RawVoice[];
}

function cacheOptions(c: { public?: RawVoice[]; private?: RawVoice[]; extra?: RawVoice[] }): VoiceOption[] {
  const seen = new Set<string>();
  const out: VoiceOption[] = [];
  const add = (v: RawVoice, own: boolean) => {
    if (seen.has(v.voice_id)) return;
    seen.add(v.voice_id);
    out.push(toOption(v, own));
  };
  (c.extra ?? []).forEach((v) => add(v, false));
  (c.private ?? []).forEach((v) => add(v, true));
  (c.public ?? []).forEach((v) => add(v, false));
  return out;
}

/**
 * The HeyGen catalog, cached for a week: every public Spanish voice, the 100 best English ones and
 * the workspace's own voices. (All English pages took ~6 minutes; the videos are in Spanish.)
 */
export async function heygenVoices(dataDir: string, opts: { refresh?: boolean; configDir?: string } = {}): Promise<VoiceOption[]> {
  const cache = path.join(dataDir, 'heygen-voices.json');
  const cached = readJson<HeygenCache>(cache);
  const fresh = cached && Date.now() - Date.parse(cached.at) < CATALOG_DAYS * 86_400_000;
  if (!cached || !fresh || opts.refresh) {
    const work = path.join(dataDir, 'heygen');
    fs.mkdirSync(work, { recursive: true });
    const out = path.join(work, 'voices.json');
    fs.rmSync(out, { force: true });
    const res = await runBrain({
      cwd: work,
      system: SYSTEM,
      prompt: `Las herramientas de HeyGen pueden tardar en cargar: si aún no aparecen, espera con \`sleep 10\` y vuelve a
intentar (hasta 2 minutos). No escribas el resultado hasta terminar.

Arma el catálogo de voces de HeyGen con list_voices (listar no gasta créditos):
1. type "public", language "es", limit 100: todas las páginas (usa next_token hasta que has_more sea false).
2. type "public", language "en", limit 100: solo la primera página (HeyGen las ordena de mejor a peor).
3. type "private": todas las páginas; solo las de status ACTIVE.
Escribe ${out.replace(/\\/g, '/')} con este JSON (copia los campos tal cual vienen, sin inventar):
{"public": [{"voice_id": "…", "name": "…", "language": "es", "locale": "es-MX", "gender": "female", "mode": "instant", "preview_audio_url": "…"}], "private": [ …igual… ]}
Responde en una línea cuántas voces escribiste.`,
      tools: ['Write', 'Bash'],
      allowedTools: [`${HG}list_voices`, 'Bash(sleep:*)'],
      accountMcp: true,
      model: 'sonnet',
      effort: 'low',
      configDir: opts.configDir,
    });
    const got = readJson<{ public?: RawVoice[]; private?: RawVoice[] }>(out);
    if (!got || (!got.public?.length && !got.private?.length)) {
      if (cached) return cacheOptions(cached);
      throw new Error(
        `No se pudo leer el catálogo de HeyGen: ${res.error || res.text || 'sin respuesta'}. Revisa que el MCP de HeyGen esté conectado en Claude Code.`.slice(0, 400),
      );
    }
    const next: HeygenCache = { at: new Date().toISOString(), public: got.public ?? [], private: got.private ?? [], extra: cached?.extra ?? [] };
    fs.writeFileSync(cache, JSON.stringify(next), 'utf8');
    return cacheOptions(next);
  }
  return cacheOptions(cached);
}

/**
 * One HeyGen voice by its ID (get_voice, free), for a voice heard on HeyGen's site that is not in the
 * catalog AdFlow keeps. It is saved with the catalog so it stays in the list.
 */
export async function heygenVoiceById(dataDir: string, voiceId: string, opts: { configDir?: string } = {}): Promise<VoiceOption> {
  if (!/^[A-Za-z0-9]{16,40}$/.test(voiceId)) throw new Error('Ese ID de voz no es válido.');
  const cache = path.join(dataDir, 'heygen-voices.json');
  const known = readJson<HeygenCache>(cache);
  const already = known && [...(known.extra ?? []), ...known.private, ...known.public].find((v) => v.voice_id === voiceId);
  if (already) return toOption(already, !!known?.private.some((v) => v.voice_id === voiceId));

  const work = path.join(dataDir, 'heygen');
  fs.mkdirSync(work, { recursive: true });
  const out = path.join(work, `voice-${voiceId}.json`);
  fs.rmSync(out, { force: true });
  const res = await runBrain({
    cwd: work,
    system: SYSTEM,
    prompt: `Las herramientas de HeyGen pueden tardar en cargar: si aún no aparecen, espera con \`sleep 10\` y vuelve a
intentar (hasta 2 minutos).

Llama una sola vez a get_voice con voiceId "${voiceId}" (no gasta créditos) y escribe ${out.replace(/\\/g, '/')} con este JSON,
copiando los campos tal cual vienen:
{"voice_id": "…", "name": "…", "language": "…", "locale": "…", "gender": "…", "mode": "…", "status": "…", "preview_audio_url": "…"}
Si HeyGen responde que no existe o da error, escribe {"error": "<el mensaje de HeyGen>"}. Responde en una línea qué escribiste.`,
    tools: ['Write', 'Bash'],
    allowedTools: [`${HG}get_voice`, 'Bash(sleep:*)'],
    accountMcp: true,
    model: 'sonnet',
    effort: 'low',
    configDir: opts.configDir,
  });
  const got = readJson<RawVoice & { error?: string }>(out);
  if (!got?.voice_id) {
    throw new Error(`HeyGen no encontró la voz con ese ID: ${got?.error || res.error || res.text || 'sin respuesta'}`.slice(0, 300));
  }
  if (got.status && got.status !== 'ACTIVE') throw new Error(`Esa voz de HeyGen no está lista para hablar (estado ${got.status}).`);
  const voice: RawVoice = { ...got, voice_id: voiceId };
  const base: HeygenCache = known ?? { at: new Date(0).toISOString(), public: [], private: [] };
  fs.writeFileSync(cache, JSON.stringify({ ...base, extra: [voice, ...(base.extra ?? []).filter((v) => v.voice_id !== voiceId)] }), 'utf8');
  return toOption(voice, false);
}

/**
 * One-attempt lock for speech, enforced by Claude Code (PreToolUse hook): create_speech only for the
 * texts AdFlow asked for, and each text at most once per run. Anything else is blocked.
 */
const GUARD_SCRIPT = `const fs = require('fs');
const crypto = require('crypto');
const [allowedFile, usedDir] = process.argv.slice(2);
let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  let ev = {};
  try { ev = JSON.parse(raw); } catch {}
  const tool = String(ev.tool_name || '');
  if (!/create_speech(_without_player)?$/.test(tool)) process.exit(0);
  const text = String((ev.tool_input || {}).text || '');
  const hash = crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
  const allowed = JSON.parse(fs.readFileSync(allowedFile, 'utf8'));
  const block = (why) => { process.stderr.write(why); process.exit(2); };
  if (!allowed.includes(hash)) block('Bloqueado por AdFlow: ese texto no es una de las frases pedidas. Usa el texto exacto.');
  const marker = require('path').join(usedDir, hash + '.used');
  if (fs.existsSync(marker)) block('Bloqueado por AdFlow: esta frase ya tuvo su único intento. No se reintenta: anota el error en el resultado.');
  fs.mkdirSync(usedDir, { recursive: true });
  fs.writeFileSync(marker, new Date().toISOString());
  process.exit(0);
});
`;

const textHash = (t: string) => createHash('sha256').update(t).digest('hex').slice(0, 16);

export interface HeygenLine {
  id: string;
  text: string;
}

export interface HeygenSpeechResult {
  /** Saved audio per line id. */
  files: Record<string, string>;
  errors: Record<string, string>;
  creditsBefore?: number;
  creditsAfter?: number;
  error?: string;
}

/** Generates the lines with HeyGen (one call each, never repeated) and saves them as MP3 in outDir. */
export async function heygenSpeech(opts: {
  dir: string;
  outDir: string;
  voiceId: string;
  lines: HeygenLine[];
  configDir?: string;
  signal?: AbortSignal;
  onEvent?: (e: BrainEvent) => void;
}): Promise<HeygenSpeechResult> {
  const adflow = path.join(opts.dir, '.adflow');
  const run = path.join(adflow, `heygen-${Date.now()}`);
  fs.mkdirSync(run, { recursive: true });
  const allowedFile = path.join(run, 'allowed.json');
  fs.writeFileSync(allowedFile, JSON.stringify(opts.lines.map((l) => textHash(l.text))));
  const script = path.join(adflow, 'heygen-guard.cjs');
  fs.writeFileSync(script, GUARD_SCRIPT, 'utf8');
  const resultFile = path.join(run, 'result.json');
  const q = (p: string) => `"${p.replace(/\\/g, '/')}"`;

  const res = await runBrain({
    cwd: run,
    system: SYSTEM,
    prompt: `Las herramientas de HeyGen pueden tardar en cargar: si aún no aparecen, espera con \`sleep 10\` y vuelve a
intentar (hasta 2 minutos). No escribas el resultado hasta terminar.

Genera la voz del narrador con HeyGen, una sola vez por frase.

Voz: ${opts.voiceId}
Frases (usa el texto exacto, sin cambiar una letra):
${opts.lines.map((l) => `- ${l.id}: ${JSON.stringify(l.text)}`).join('\n')}

Receta:
1. get_current_user: anota subscription.credits.premium_credits.remaining como credits_before.
2. Para cada frase, en orden, una sola llamada a create_speech_without_player con voiceId "${opts.voiceId}",
   text (exacto), language "es" y outputFormat {"encoding": "mp3"}. Cada llamada gasta cuota: NUNCA la repitas,
   ni si falla; si falla, anota el error de esa frase y sigue con la siguiente.
3. get_current_user otra vez: credits_after.
4. Escribe ${resultFile.replace(/\\/g, '/')}:
{"credits_before": 1014, "credits_after": 1010, "lines": [{"id": "n01", "audio_url": "url del audio", "error": null}]}
No descargues los audios: AdFlow lo hace. Responde en una línea qué pasó.`,
    tools: ['Write', 'Bash'],
    allowedTools: [`${HG}create_speech_without_player`, `${HG}get_current_user`, 'Bash(sleep:*)'],
    accountMcp: true,
    model: 'sonnet',
    effort: 'low',
    configDir: opts.configDir,
    signal: opts.signal,
    onEvent: opts.onEvent,
    settings: {
      hooks: {
        PreToolUse: [{ matcher: `${HG}.*`, hooks: [{ type: 'command', command: `node ${q(script)} ${q(allowedFile)} ${q(path.join(run, 'used'))}` }] }],
      },
    },
  });

  const out = readJson<{ credits_before?: number; credits_after?: number; lines?: { id: string; audio_url?: string | null; error?: string | null }[] }>(resultFile);
  const result: HeygenSpeechResult = { files: {}, errors: {}, creditsBefore: out?.credits_before, creditsAfter: out?.credits_after };
  if (!out) {
    result.error = `${res.error || res.text || 'Claude no dejó el resultado.'}`.slice(0, 400);
    return result;
  }
  fs.mkdirSync(opts.outDir, { recursive: true });
  for (const l of out.lines ?? []) {
    if (!opts.lines.some((x) => x.id === l.id)) continue;
    if (!l.audio_url) {
      result.errors[l.id] = l.error || 'Sin audio';
      continue;
    }
    try {
      const r = await fetch(l.audio_url, { signal: opts.signal });
      if (!r.ok) throw new Error(`descarga ${r.status}`);
      const file = path.join(opts.outDir, `${l.id}.mp3`);
      fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
      result.files[l.id] = file;
    } catch (err) {
      result.errors[l.id] = `No se pudo descargar el audio: ${String((err as Error)?.message ?? err)}`;
    }
  }
  return result;
}
