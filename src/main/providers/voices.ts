// Voice providers that cost nothing: the voices installed in Windows and Edge TTS. Paid voices
// (ElevenLabs, HeyGen, OpenAI) only list their catalog here; generating with them is blocked.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { VoiceOption } from '@shared/types';
import { runCli } from '../proc';

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
  if (!key) throw new Error('Agrega la API key de ElevenLabs en Ajustes para ver sus voces.');
  // Listing voices does not spend credits.
  const res = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': key } });
  if (!res.ok) throw new Error(`ElevenLabs respondió ${res.status}`);
  const data = (await res.json()) as { voices: { voice_id: string; name: string; labels?: Record<string, string> }[] };
  return data.voices.map((v) => ({
    id: v.voice_id,
    name: v.name,
    language: v.labels?.language ?? v.labels?.accent ?? '',
    gender: v.labels?.gender,
    description: v.labels?.description,
  }));
}

export async function listVoices(providerId: string, secrets: Record<string, string>): Promise<VoiceOption[]> {
  switch (providerId) {
    case 'windows-sapi':
      return sapiVoices();
    case 'edge-tts': {
      const all = await edgeVoices();
      return all.filter((v) => v.language.startsWith('es')).concat(all.filter((v) => !v.language.startsWith('es')));
    }
    case 'elevenlabs':
      return elevenVoices(secrets.elevenlabs);
    default:
      throw new Error('Este proveedor todavía no está conectado en AdFlow.');
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
): Promise<{ ok: boolean; file: string; error?: string }> {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
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
  return { ok: false, file: outFile, error: 'Este proveedor gasta créditos y todavía está bloqueado en AdFlow.' };
}
