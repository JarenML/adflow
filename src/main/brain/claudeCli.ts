// The brain: the Claude Code installed on this computer, run headless with the person's own
// subscription (`claude -p --output-format stream-json`). AdFlow never sees a password or key:
// Claude Code uses whatever account it is signed in as (or a managed CLAUDE_CONFIG_DIR).
import fs from 'node:fs';
import path from 'node:path';
import type { CostEntry, StepId } from '@shared/types';
import { startCli } from '../proc';
import { limitsReported, runEnded, runStarted } from './claudeLimits';

export interface BrainEvent {
  kind: 'start' | 'text' | 'tool' | 'result' | 'error';
  text: string;
}

export interface BrainRun {
  cwd: string;
  prompt: string;
  /** Appended to Claude Code's own system prompt (written to a file to avoid command-line limits). */
  system?: string;
  sessionId?: string;
  model?: string;
  effort?: string;
  addDirs?: string[];
  /** Built-in tools Claude may use. File tools only: the brain writes files, AdFlow runs providers. */
  tools?: string[];
  /** Permission rules for tools that would otherwise ask (e.g. Bash(npx remotion still:*)). */
  allowedTools?: string[];
  /**
   * Lets Claude reach the connectors of its Claude account (e.g. ElevenLabs). Off by default: the
   * brain runs isolated, with no MCP server. Only the tools in allowedTools can actually be called.
   */
  accountMcp?: boolean;
  /** Extra Claude Code settings (e.g. hooks that guard paid tools), passed with --settings. */
  settings?: Record<string, unknown>;
  configDir?: string;
  signal?: AbortSignal;
  onEvent?: (e: BrainEvent) => void;
  /** The episode and step this run works for: its usage is added to the episode's costs. */
  usageFor?: BrainUsageTag;
}

export interface BrainUsageTag {
  episodeId: string;
  step: StepId;
  label: string;
}

export interface BrainResult {
  ok: boolean;
  sessionId?: string;
  text: string;
  costUsd?: number;
  durationMs?: number;
  tokens?: CostEntry['tokens'];
  model?: string;
  error?: string;
}

/** Every finished run (tagged or not) is reported here: the pipeline adds tagged ones to their episode. */
type UsageListener = (tag: BrainUsageTag | undefined, res: BrainResult) => void;
let usageListener: UsageListener = () => {};
export function onBrainUsage(fn: UsageListener): void {
  usageListener = fn;
}

function tokensOf(u: Record<string, any> | undefined): CostEntry['tokens'] {
  if (!u) return undefined;
  const n = (v: unknown) => (typeof v === 'number' ? v : 0);
  return { input: n(u.input_tokens), output: n(u.output_tokens), cacheRead: n(u.cache_read_input_tokens), cacheWrite: n(u.cache_creation_input_tokens) };
}

const DEFAULT_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep'];

/** One-line description of a tool call for the activity feed. */
function describeTool(name: string, input: Record<string, unknown>): string {
  const file = (input.file_path ?? input.path ?? input.pattern ?? '') as string;
  const short = file ? path.basename(String(file)) : '';
  switch (name) {
    case 'Write':
      return `Escribe ${short}`;
    case 'Edit':
      return `Corrige ${short}`;
    case 'Read':
      return `Lee ${short}`;
    case 'Glob':
    case 'Grep':
      return `Busca ${short}`;
    case 'Bash':
      return `Ejecuta ${String(input.command ?? '').split(' ')[0]}`;
    default:
      // Connector tools: mcp__claude_ai_ElevenLabs__creative_generate_video → ElevenLabs · creative_generate_video
      if (name.startsWith('mcp__')) {
        const [, server = '', tool = ''] = name.split('__');
        return `${server.replace(/^claude_ai_/, '').replace(/_/g, ' ')} · ${tool}`;
      }
      return `${name} ${short}`.trim();
  }
}

export const BRAIN_FILE_TOOLS = DEFAULT_TOOLS;

export function runBrain(run: BrainRun): Promise<BrainResult> {
  const adflowDir = path.join(run.cwd, '.adflow');
  fs.mkdirSync(adflowDir, { recursive: true });
  const mcpFile = path.join(adflowDir, 'mcp.json');
  fs.writeFileSync(mcpFile, JSON.stringify({ mcpServers: {} }));

  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    ...(run.accountMcp ? [] : ['--strict-mcp-config', '--mcp-config', mcpFile]),
    '--tools',
    (run.tools ?? DEFAULT_TOOLS).join(','),
    '--permission-mode',
    'acceptEdits',
  ];
  if (run.model) args.push('--model', run.model);
  if (run.effort) args.push('--effort', run.effort);
  if (run.sessionId) args.push('--resume', run.sessionId);
  for (const d of run.addDirs ?? []) args.push('--add-dir', d);
  if (run.settings) {
    const settingsFile = path.join(adflowDir, `settings-${process.pid}-${Date.now()}.json`);
    fs.writeFileSync(settingsFile, JSON.stringify(run.settings), 'utf8');
    args.push('--settings', settingsFile);
  }
  if (run.allowedTools?.length) args.push('--allowedTools', ...run.allowedTools);
  if (run.system) {
    const sysFile = path.join(adflowDir, 'system-prompt.md');
    fs.writeFileSync(sysFile, run.system, 'utf8');
    args.push('--append-system-prompt-file', sysFile);
  }

  const env = { ...process.env };
  if (run.configDir) env.CLAUDE_CONFIG_DIR = run.configDir;
  delete env.ANTHROPIC_API_KEY; // never switch to API billing by accident

  return new Promise((resolve) => {
    const child = startCli('claude', args, { cwd: run.cwd, env });
    runStarted();
    let buffer = '';
    let stderr = '';
    let sessionId = run.sessionId;
    let final: BrainResult | null = null;
    const emit = (e: BrainEvent) => run.onEvent?.(e);

    const handle = (line: string) => {
      if (!line.trim()) return;
      let ev: Record<string, any>;
      try {
        ev = JSON.parse(line);
      } catch {
        return;
      }
      if (ev.type === 'rate_limit_event') {
        limitsReported(ev.rate_limit_info, run.configDir);
      } else if (ev.type === 'system' && ev.subtype === 'init') {
        sessionId = ev.session_id;
        emit({ kind: 'start', text: `Sesión ${String(ev.session_id).slice(0, 8)} · ${ev.model ?? ''}` });
      } else if (ev.type === 'assistant') {
        for (const block of ev.message?.content ?? []) {
          if (block.type === 'text' && block.text?.trim()) emit({ kind: 'text', text: block.text.trim() });
          if (block.type === 'tool_use') emit({ kind: 'tool', text: describeTool(block.name, block.input ?? {}) });
        }
      } else if (ev.type === 'result') {
        final = {
          ok: !ev.is_error && ev.subtype === 'success',
          sessionId: ev.session_id ?? sessionId,
          text: ev.result ?? '',
          costUsd: ev.total_cost_usd,
          durationMs: ev.duration_ms,
          tokens: tokensOf(ev.usage),
          model: Object.keys(ev.modelUsage ?? {}).join(', ') || undefined,
          error: ev.is_error ? String(ev.result ?? ev.subtype) : undefined,
        };
        emit({ kind: final.ok ? 'result' : 'error', text: final.ok ? 'Listo' : final.error ?? 'Error' });
      }
    };

    child.stdout?.on('data', (d: Buffer) => {
      buffer += d.toString('utf8');
      let i: number;
      while ((i = buffer.indexOf('\n')) >= 0) {
        handle(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
      }
    });
    child.stderr?.on('data', (d) => (stderr += d));
    const onAbort = () => child.kill();
    run.signal?.addEventListener('abort', onAbort);
    child.on('error', (err) => {
      stderr += String(err);
    });
    child.on('close', (code) => {
      run.signal?.removeEventListener('abort', onAbort);
      handle(buffer);
      runEnded(final?.costUsd);
      if (final) {
        usageListener(run.usageFor, final);
        return resolve(final);
      }
      const error = run.signal?.aborted
        ? 'Cancelado'
        : stderr.trim() || `Claude Code terminó con código ${code}`;
      emit({ kind: 'error', text: error });
      resolve({ ok: false, sessionId, text: '', error });
    });
    child.stdin?.end(run.prompt);
  });
}

/**
 * The smallest Claude request there is (Haiku, one word back), made only to get Claude Code's
 * `rate_limit_event` and so the account's current limits.
 */
export async function probeClaudeLimits(cwd: string, configDir?: string): Promise<boolean> {
  const res = await runBrain({ cwd, prompt: 'Responde solo: ok', model: 'haiku', tools: ['Read'], configDir });
  return res.ok;
}
