// Image generation through the Codex CLI (`codex exec`), as the playbook describes: the prompt is
// written to stdin, references go with -i, and Codex saves one PNG at the requested path.
import fs from 'node:fs';
import path from 'node:path';
import { runCli } from '../proc';

export interface ImageJob {
  cwd: string;
  file: string;
  prompt: string;
  references: string[];
  signal?: AbortSignal;
}

export async function generateWithCodex(job: ImageJob): Promise<{ ok: boolean; error?: string }> {
  const target = path.join(job.cwd, job.file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const before = fs.existsSync(target) ? fs.statSync(target).mtimeMs : 0;

  const refs = job.references.map((r) => path.join(job.cwd, r)).filter((r) => fs.existsSync(r));
  const instructions = [
    'Generate exactly one image with your image generation tool, using the prompt below verbatim.',
    `Save it as a PNG at ${job.file.replace(/\\/g, '/')} (portrait 9:16, at least 1080x1920).`,
    refs.length ? 'The attached images are references: keep the same people, clothes and objects.' : '',
    'Do not create, edit or delete any other file. Reply with the saved path only.',
    '',
    'PROMPT:',
    job.prompt,
  ]
    .filter((l) => l !== '')
    .join('\n');

  const args = ['exec', '--skip-git-repo-check', '--sandbox', 'workspace-write', '-C', job.cwd];
  for (const r of refs) args.push('-i', r);
  args.push('-');

  const res = await runCli('codex', args, {
    cwd: job.cwd,
    input: instructions,
    timeoutMs: 6 * 60_000,
    signal: job.signal,
  });
  const after = fs.existsSync(target) ? fs.statSync(target).mtimeMs : 0;
  if (after > before) return { ok: true };
  const tail = (res.stderr || res.stdout).trim().split('\n').slice(-4).join(' ');
  return { ok: false, error: job.signal?.aborted ? 'Cancelado' : `Codex no guardó la imagen. ${tail}`.trim() };
}
