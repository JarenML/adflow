// Voice providers: the free ones (Windows voices, Edge TTS) and ElevenLabs with the person's key
// (it spends credits, so the pipeline checks it is allowed first). HeyGen and OpenAI only list.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { VoiceOption } from '@shared/types';
import { runCli } from '../proc';
import { elevenSpeech } from './elevenlabs';
import { heygenVoiceById, heygenVoices } from './heygenMcp';

const ps = (script: string, timeoutMs = 60_000) =>
  runCli('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    timeoutMs,
    shell: false,
  });

async function sapiVoices(): Promise<VoiceOption[]> {
  if (process.platform !== 'win32') return [];
  const res = await ps(
    'Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | ' +
      'ForEach-Object { $v=$_.VoiceInfo; "$($v.Name)|$($v.Culture)|$($v.Gender)" }',
  );
  return res.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => {
      const [name, language, gender] = l.split('|');
      return { id: name, name, language, gender };
    });
}

async function edgeVoices(): Promise<VoiceOption[]> {
  const res = await runCli('python', ['-m', 'edge_tts', '--list-voices'], { timeoutMs: 30_000, shell: false });
  if (res.code !== 0) throw new Error('Edge TTS no está instalado: ejecuta `pip install edge-tts`.');
  const out: VoiceOption[] = [];
  for (const line of res.stdout.split(/\r?\n/)) {
    const m = /^([a-z]{2}-[A-Z]{2}-\w+Neural)\s+(Male|Female)/.exec(line.trim());
    if (m) out.push({ id: m[1], name: m[1].split('-')[2].replace('Neural', ''), language: m[1].slice(0, 5), gender: m[2] });
  }
  return out;
}

async function elevenVoices(key?: string): Promise<VoiceOption[]> {
  if (!key) throw new Error('Agrega la clave de API de ElevenLabs en Ajustes para ver sus voces.');
  // Listing voices does not spend credits.
  const res = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': key } });
  if (!res.ok) throw new Error(`ElevenLabs respondió ${res.status}`);
  const data = (await res.json()) as { voices: { voice_id: string; name: string; labels?: Record<string, string>; preview_url?: string | null }[] };
  return data.voices.map((v) => ({
    id: v.voice_id,
    name: v.name,
    language: v.labels?.language ?? v.labels?.accent ?? '',
    gender: v.labels?.gender,
    description: v.labels?.description,
    // Every voice comes with a sample ElevenLabs already recorded: playing it spends no credits.
    previewUrl: v.preview_url || undefined,
  }));
}

/**
 * Where ElevenLabs keeps voice samples: its own API (voices of the account) and its public Google
 * Cloud bucket (premade and library voices). Nothing else is downloaded.
 */
export function isElevenSampleUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (/(^|\.)elevenlabs\.io$/.test(url.hostname)) return true;
  // HeyGen keeps its voice previews on its resource CDN (resource2.heygen.ai/voice_preview/…).
  if (/(^|\.)heygen\.ai$/.test(url.hostname) || /(^|\.)heygen\.com$/.test(url.hostname)) return true;
  return url.hostname === 'storage.googleapis.com' && url.pathname.startsWith('/eleven-public-prod/');
}

/**
 * The provider's recorded sample of a voice, saved once in the app's data folder (the page may only
 * play local audio). Free: it is a file ElevenLabs already has, nothing is generated.
 */
export async function voiceSample(dataDir: string, voiceId: string, previewUrl: string): Promise<string> {
  if (!isElevenSampleUrl(previewUrl)) throw new Error('Solo se aceptan muestras de ElevenLabs o HeyGen.');
  const url = new URL(previewUrl);
  const file = path.join(dataDir, 'voice-samples', `${voiceId.replace(/[^\w-]/g, '')}.mp3`);
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return file;
  // Downloading a sample is free, so a dropped connection is simply tried again once.
  const get = () => fetch(url, { signal: AbortSignal.timeout(30_000) });
  const res = await get().catch(() => get());
  if (!res.ok) throw new Error(`No se pudo descargar la muestra (${res.status}).`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

export async function listVoices(providerId: string, secrets: Record<string, string>, opts: { dataDir?: string; refresh?: boolean } = {}): Promise<VoiceOption[]> {
  switch (providerId) {
    case 'heygen-voice':
      // Through the HeyGen MCP of Claude Code (listing is free); cached for a week.
      if (!opts.dataDir) throw new Error('Falta la carpeta de datos de AdFlow.');
      return heygenVoices(opts.dataDir, { refresh: opts.refresh });
    case 'windows-sapi':
      return sapiVoices();
    case 'edge-tts': {
      const all = await edgeVoices();
      return all.filter((v) => v.language.startsWith('es')).concat(all.filter((v) => !v.language.startsWith('es')));
    }
    case 'elevenlabs':
      return elevenVoices(secrets.elevenlabs);
    default:
      throw new Error('Este proveedor aún no está disponible en AdFlow.');
  }
}

/** One voice by its ID, for a voice heard on the provider's site that the list does not show (free). */
export async function voiceById(providerId: string, voiceId: string, secrets: Record<string, string>, opts: { dataDir?: string } = {}): Promise<VoiceOption> {
  const id = voiceId.trim();
  if (!/^[A-Za-z0-9]{16,40}$/.test(id)) throw new Error('Ese ID de voz no es válido.');
  switch (providerId) {
    case 'heygen-voice':
      if (!opts.dataDir) throw new Error('Falta la carpeta de datos de AdFlow.');
      return heygenVoiceById(opts.dataDir, id);
    case 'elevenlabs': {
      if (!secrets.elevenlabs) throw new Error('Agrega la clave de API de ElevenLabs en Ajustes.');
      const res = await fetch(`https://api.elevenlabs.io/v1/voices/${id}`, { headers: { 'xi-api-key': secrets.elevenlabs } });
      if (!res.ok) throw new Error(res.status === 404 || res.status === 400 ? 'ElevenLabs no tiene una voz con ese ID en tu cuenta (agrégala primero a "Mis voces").' : `ElevenLabs respondió ${res.status}`);
      const v = (await res.json()) as { voice_id: string; name: string; labels?: Record<string, string>; preview_url?: string | null };
      return { id: v.voice_id, name: v.name, language: v.labels?.language ?? v.labels?.accent ?? '', gender: v.labels?.gender, description: v.labels?.description, previewUrl: v.preview_url || undefined };
    }
    default:
      throw new Error('Este proveedor no permite buscar voces por ID.');
  }
}

/** Strips performance tags like [excited] that only paid voices understand. */
export function plainText(text: string): string {
  return text.replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
}

export async function synthesize(
  providerId: string,
  voiceId: string,
  text: string,
  outFile: string,
  keys: Record<string, string> = {},
): Promise<{ ok: boolean; file: string; error?: string }> {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  if (providerId === 'elevenlabs') {
    if (!keys.elevenlabs) return { ok: false, file: outFile, error: 'Falta la clave de API de ElevenLabs en Ajustes.' };
    try {
      return { ok: true, file: await elevenSpeech(keys.elevenlabs, voiceId, text, outFile) };
    } catch (err) {
      return { ok: false, file: outFile, error: String((err as Error)?.message ?? err) };
    }
  }
  const clean = plainText(text);
  if (providerId === 'windows-sapi') {
    const out = outFile.replace(/\.\w+$/, '.wav');
    const txt = path.join(os.tmpdir(), `adflow-tts-${process.pid}-${Date.now()}.txt`);
    fs.writeFileSync(txt, clean, 'utf8');
    const esc = (s: string) => s.replace(/'/g, "''");
    const res = await ps(
      `Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; ` +
        `$s.SelectVoice('${esc(voiceId)}'); $s.SetOutputToWaveFile('${esc(out)}'); ` +
        `$s.Speak([IO.File]::ReadAllText('${esc(txt)}',[Text.Encoding]::UTF8)); $s.Dispose()`,
    );
    fs.rmSync(txt, { force: true });
    return fs.existsSync(out) ? { ok: true, file: out } : { ok: false, file: out, error: res.stderr.trim() || 'Sin audio' };
  }
  if (providerId === 'edge-tts') {
    const out = outFile.replace(/\.\w+$/, '.mp3');
    const res = await runCli('python', ['-m', 'edge_tts', '--voice', voiceId, '--text', clean, '--write-media', out], {
      timeoutMs: 120_000,
      shell: false,
    });
    return fs.existsSync(out) ? { ok: true, file: out } : { ok: false, file: out, error: res.stderr.trim() || 'Sin audio' };
  }
  return { ok: false, file: outFile, error: 'Este proveedor consume créditos y no está habilitado en Ajustes.' };
}
