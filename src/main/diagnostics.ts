// First-run checks: what this computer has and what is missing. Nothing here spends credits.
import type { DiagnosticItem, Settings } from '@shared/types';
import { runCli } from './proc';
import { playbookReady, sectionStatus } from './playbook';
import { activePlaybook } from './store';

async function version(cmd: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  const r = await runCli(cmd, args, { timeoutMs: 20_000 });
  const out = (r.stdout || r.stderr).trim().split('\n')[0] ?? '';
  return { ok: r.code === 0, out };
}

export async function runDiagnostics(settings: Settings): Promise<DiagnosticItem[]> {
  const pb = activePlaybook(settings);
  const [claude, codex, node, python, ffmpeg, edge, whisper] = await Promise.all([
    version('claude', ['--version']),
    version('codex', ['--version']),
    version('node', ['--version']),
    version('python', ['--version']),
    version('ffmpeg', ['-version']),
    runCli('python', ['-c', 'import edge_tts'], { timeoutMs: 20_000, shell: false }),
    runCli('python', ['-c', 'import faster_whisper'], { timeoutMs: 30_000, shell: false }),
  ]);
  const ready = playbookReady(pb);
  const missingSections = ready.ok ? sectionStatus(pb).filter((s) => !s.found).map((s) => s.id) : [];

  return [
    {
      id: 'claude',
      label: 'Claude Code (cerebro)',
      ok: claude.ok,
      detail: claude.ok ? `${claude.out} · usa la sesión iniciada en esta computadora` : 'Instala Claude Code e inicia sesión con tu cuenta.',
      required: true,
    },
    {
      id: 'playbook',
      label: `Playbook · ${pb.name}`,
      ok: ready.ok && missingSections.length === 0,
      detail: !ready.ok
        ? ready.problems.join(' ')
        : missingSections.length
          ? `El prompt maestro no tiene las secciones: ${missingSections.join(', ')}`
          : pb.rootDir,
      required: true,
    },
    {
      id: 'codex',
      label: 'Codex CLI (imágenes)',
      ok: codex.ok,
      detail: codex.ok ? codex.out : 'Instala Codex CLI (npm i -g @openai/codex) e inicia sesión.',
      required: false,
    },
    { id: 'node', label: 'Node.js (Remotion)', ok: node.ok, detail: node.ok ? node.out : 'Instala Node 20 o superior.', required: true },
    { id: 'ffmpeg', label: 'ffmpeg (mezcla y cuadros)', ok: ffmpeg.ok, detail: ffmpeg.ok ? ffmpeg.out.slice(0, 60) : 'Instala ffmpeg y agrégalo al PATH.', required: false },
    { id: 'python', label: 'Python (herramientas)', ok: python.ok, detail: python.ok ? python.out : 'Instala Python 3.10 o superior.', required: false },
    {
      id: 'whisper',
      label: 'faster-whisper (transcripción)',
      ok: whisper.code === 0,
      detail: whisper.code === 0 ? 'Instalado' : 'pip install faster-whisper',
      required: false,
    },
    {
      id: 'edge',
      label: 'Edge TTS (voz temporal gratis)',
      ok: edge.code === 0,
      detail: edge.code === 0 ? 'Instalado' : 'Opcional: pip install edge-tts',
      required: false,
    },
  ];
}
