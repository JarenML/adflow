// Small helpers to run command-line tools (Claude Code, Codex, ffmpeg, python…).
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';

const quote = (a: string) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);

/**
 * Starts a command. On Windows, tools installed by npm are `.cmd` shims that need a shell;
 * real executables (claude.exe) run without one so arguments are passed untouched.
 */
export function startCli(cmd: string, args: string[], opts: SpawnOptions & { shell?: boolean } = {}): ChildProcess {
  const useShell = opts.shell ?? (process.platform === 'win32' && !/\.exe$/i.test(cmd) && cmd !== 'claude');
  if (useShell) {
    return spawn([cmd, ...args.map(quote)].join(' '), [], { ...opts, shell: true, windowsHide: true });
  }
  return spawn(cmd, args, { ...opts, shell: false, windowsHide: true });
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export function runCli(
  cmd: string,
  args: string[],
  opts: SpawnOptions & { input?: string; timeoutMs?: number; shell?: boolean; signal?: AbortSignal } = {},
): Promise<RunResult> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = startCli(cmd, args, opts);
    } catch (err) {
      resolve({ code: -1, stdout: '', stderr: String(err) });
      return;
    }
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => (stdout += d));
    child.stderr?.on('data', (d) => (stderr += d));
    const timer = opts.timeoutMs ? setTimeout(() => child.kill(), opts.timeoutMs) : null;
    const onAbort = () => child.kill();
    opts.signal?.addEventListener('abort', onAbort);
    child.on('error', (err) => {
      stderr += String(err);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      resolve({ code, stdout, stderr });
    });
    if (opts.input !== undefined) child.stdin?.end(opts.input);
    else child.stdin?.end();
  });
}
