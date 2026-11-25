// Clips through the ElevenLabs connector (MCP) of the person's Claude account, for plans whose API
// does not allow video (Creator). AdFlow cannot call the connector itself, so Claude does the MCP
// part with a fixed recipe — flow, upload the scene image as first frame, set duration/aspect,
// estimate, generate once, wait — and writes the result to a JSON file. AdFlow then downloads the
// MP4. Generating spends credits, so the recipe forbids retrying a generation and caps the price.
import fs from 'node:fs';
import path from 'node:path';
import { runBrain, type BrainEvent, type BrainUsageTag } from '../brain/claudeCli';

const EL = 'mcp__claude_ai_ElevenLabs__';

/** Only these connector tools may be called (everything else of the account stays denied). */
export const MCP_CLIP_TOOLS = [
  'creative_create_flow',
  'creative_create_asset_upload',
  'creative_finalize_asset_upload',
  'creative_generate_video',
  'creative_get_flow_node',
  'creative_get_model_schema',
  'creative_connect_flow_nodes',
  'creative_disconnect_flow_nodes',
  'creative_update_node',
  'creative_run_flow_nodes',
  'creative_get_flow_run_status',
].map((t) => EL + t);

/** Credits Veo 3.1 Fast charges per second of clip, with some margin for the cap. */
const CREDITS_PER_SECOND = 910;

export interface McpClipJob {
  /** Episode folder (Claude's working directory). */
  dir: string;
  sceneId: string;
  /** Image relative to dir (first frame). */
  image: string;
  /** Output MP4 relative to dir. */
  file: string;
  prompt: string;
  durationS: number;
  resolution: '720p' | '1080p';
  audio: boolean;
  flowName: string;
  /** Stop after the estimate (no credits spent). */
  estimateOnly?: boolean;
  /** Claude model for the recipe (default: sonnet, effort low). */
  model?: string;
  effort?: string;
  configDir?: string;
  signal?: AbortSignal;
  onEvent?: (e: BrainEvent) => void;
  usageFor?: BrainUsageTag;
}

export interface McpClipResult {
  ok: boolean;
  contentUrl?: string;
  credits?: number;
  flowUrl?: string;
  error?: string;
  costUsd?: number;
}

export function clipDuration(seconds: number): 4 | 6 | 8 {
  return ([4, 6, 8] as const).find((d) => d >= seconds) ?? 8;
}

export function mcpClipPrompt(job: McpClipJob, imageAbs: string, size: number, resultFile: string): string {
  const duration = clipDuration(job.durationS);
  const maxCredits = Math.round(duration * CREDITS_PER_SECOND * 1.15);
  const mime = /\.jpe?g$/i.test(imageAbs) ? 'image/jpeg' : /\.webp$/i.test(imageAbs) ? 'image/webp' : 'image/png';
  return `Genera el clip de la escena ${job.sceneId} con las herramientas de ElevenLabs, siguiendo esta receta al pie de la letra.

Datos:
- Imagen (primer fotograma): ${imageAbs} · ${mime} · ${size} bytes
- Modelo: veo-3.1-fast-generate-001
- Parámetros: duration_secs ${duration}, aspect_ratio "9:16", resolution "${job.resolution}", generate_audio ${job.audio}
- Precio máximo: ${maxCredits} créditos
- Prompt (úsalo tal cual, sin cambiar una palabra):
<<<PROMPT
${job.prompt}
PROMPT>>>

Las herramientas de ElevenLabs pueden tardar unos segundos en cargar: si aún no aparecen, espera con
\`sleep 5\` y vuelve a intentar (hasta 1 minuto). No escribas el resultado hasta terminar la receta.

Receta:
1. creative_create_flow con name "${job.flowName}".
2. creative_create_asset_upload con name "${path.basename(imageAbs)}", mime_type "${mime}", file_size ${size}.
3. Sube los bytes con un solo comando:
   curl -sS -f -X PUT -H "Content-Type: ${mime}" --data-binary "@${imageAbs.replace(/\\/g, '/')}" "<upload_url>"
4. creative_finalize_asset_upload con el asset_id y el flow_id: te da el node_id de la imagen.
5. creative_generate_video con el prompt, model_id, flow_id, connect_from [node_id de la imagen] y estimate_only true
   (crea el nodo sin generar ni cobrar).
6. creative_get_flow_node del nodo de video: la imagen debe estar conectada al puerto start_frame. Si está en
   otro puerto, desconéctala (creative_disconnect_flow_nodes) y conéctala con creative_connect_flow_nodes
   y target_port "start_frame".
7. creative_update_node del nodo de video con model_parameters exactamente:
   {"duration_secs": ${duration}, "aspect_ratio": "9:16", "resolution": "${job.resolution}", "generate_audio": ${job.audio}}
8. creative_run_flow_nodes con estimate_only true. Si cuesta más de ${maxCredits} créditos, NO generes: escribe el
   resultado con ok false y el motivo.
${
  job.estimateOnly
    ? '9. Prueba sin gastar: detente aquí. Escribe el resultado con ok true, credits del estimado y sin content_url.'
    : `9. creative_run_flow_nodes una sola vez (sin estimate_only). Esta llamada cobra: NUNCA la repitas, ni si algo
   falla después; si falla, escribe el resultado con ok false.
10. Espera con \`sleep 20\` entre consultas y llama a creative_get_flow_run_status con el flow_id y los
    session_ids hasta que all_completed o has_failures sea true (máximo 15 minutos).`
}

Al terminar (bien o mal) escribe ${resultFile} con este JSON:
{"ok": true, "content_url": "master_url o content_url del video", "credits": 3636, "flow_url": "url del flow", "error": null}
No descargues el video: AdFlow lo hace. Responde en una línea qué pasó.`;
}

const SYSTEM = `Eres el operador de clips de AdFlow. Solo usas las herramientas de ElevenLabs que te permiten, curl
para subir la imagen y sleep para esperar. No haces preguntas, no cambias el prompt y no generas más de
una vez. Escribe en español.`;

/**
 * The one-attempt lock, enforced by Claude Code itself (a PreToolUse hook), not by the prompt:
 * - creative_generate_video may only estimate (estimate_only true); it never charges.
 * - creative_run_flow_nodes without estimate_only (the only call that charges) is allowed once per
 *   image: the first call leaves a marker file and any later one is blocked.
 * - with estimateOnly, no charging call is allowed at all.
 */
const GUARD_SCRIPT = `const fs = require('fs');
const [marker, mode] = process.argv.slice(2);
let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  let ev = {};
  try { ev = JSON.parse(raw); } catch {}
  const tool = String(ev.tool_name || '');
  const input = ev.tool_input || {};
  const estimate = input.estimate_only === true || input.estimate_only === 'true';
  const block = (why) => { process.stderr.write(why); process.exit(2); };
  if (/creative_generate_video$/.test(tool) && !estimate) block('Bloqueado por AdFlow: creative_generate_video solo puede usarse con estimate_only true. Genera con creative_run_flow_nodes.');
  if (/creative_run_flow_nodes$/.test(tool) && !estimate) {
    if (mode === 'estimate') block('Bloqueado por AdFlow: esta corrida es solo de precio, no puede generar.');
    if (fs.existsSync(marker)) block('Bloqueado por AdFlow: esta imagen ya tuvo su único intento de generación. No se reintenta: escribe el resultado con ok false.');
    fs.writeFileSync(marker, new Date().toISOString());
  }
  process.exit(0);
});
`;

function guardSettings(dir: string, sceneId: string, estimateOnly: boolean): { settings: Record<string, unknown>; marker: string } {
  const adflow = path.join(dir, '.adflow');
  fs.mkdirSync(adflow, { recursive: true });
  const script = path.join(adflow, 'clip-guard.cjs');
  fs.writeFileSync(script, GUARD_SCRIPT, 'utf8');
  const marker = path.join(adflow, `clip-guard-${sceneId}-${Date.now()}.paid`);
  const q = (p: string) => `"${p.replace(/\\/g, '/')}"`;
  return {
    marker,
    settings: {
      hooks: {
        PreToolUse: [
          {
            matcher: 'mcp__claude_ai_ElevenLabs__.*',
            hooks: [{ type: 'command', command: `node ${q(script)} ${q(marker)} ${estimateOnly ? 'estimate' : 'run'}` }],
          },
        ],
      },
    },
  };
}

/** Runs the recipe with Claude and reads its result file. One generation attempt per image, never more. */
export async function mcpClip(job: McpClipJob): Promise<McpClipResult> {
  const imageAbs = path.join(job.dir, job.image);
  if (!fs.existsSync(imageAbs)) return { ok: false, error: `No existe la imagen ${job.image}.` };
  const size = fs.statSync(imageAbs).size;
  const resultFile = path.join(path.dirname(path.join(job.dir, job.file)), `${path.basename(job.file, path.extname(job.file))}.mcp.json`);
  fs.mkdirSync(path.dirname(resultFile), { recursive: true });
  fs.rmSync(resultFile, { force: true });
  const guard = guardSettings(job.dir, job.sceneId, !!job.estimateOnly);

  const res = await runBrain({
    settings: guard.settings,
    cwd: job.dir,
    prompt: mcpClipPrompt(job, imageAbs, size, resultFile),
    system: SYSTEM,
    tools: ['Bash', 'Read', 'Write'],
    allowedTools: [...MCP_CLIP_TOOLS, 'Bash(curl:*)', 'Bash(sleep:*)'],
    accountMcp: true,
    // A fixed recipe, not creative work: a light model keeps it from eating the subscription.
    model: job.model ?? 'sonnet',
    effort: job.effort ?? 'low',
    configDir: job.configDir,
    signal: job.signal,
    onEvent: job.onEvent,
    usageFor: job.usageFor,
  });

  const charged = fs.existsSync(guard.marker);
  fs.rmSync(guard.marker, { force: true });

  let out: { ok?: boolean; content_url?: string; credits?: number; flow_url?: string; error?: string | null } | null = null;
  try {
    out = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
  } catch {
    /* Claude did not write it */
  }
  if (!out) {
    const why = res.error || res.text || 'Claude no devolvió el resultado del clip.';
    const hint = charged
      ? ' La generación sí se lanzó: revisa el flow en ElevenLabs (Image & Video → History) antes de volver a intentar.'
      : /ElevenLabs|mcp|tool/i.test(why)
        ? ''
        : ' Revisa que el conector de ElevenLabs esté conectado en claude.ai → Settings → Connectors.';
    return { ok: false, error: `${why}${hint}`.slice(0, 500), costUsd: res.costUsd };
  }
  return {
    ok: !!out.ok,
    contentUrl: out.content_url || undefined,
    credits: typeof out.credits === 'number' ? out.credits : undefined,
    flowUrl: out.flow_url || undefined,
    error: out.ok ? undefined : out.error || 'El clip no se generó.',
    costUsd: res.costUsd,
  };
}

/** Saves the generated MP4 (the URL is signed and short-lived). */
export async function downloadClip(url: string, outAbs: string, signal?: AbortSignal): Promise<void> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`No se pudo descargar el clip (${res.status}).`);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  fs.writeFileSync(outAbs, Buffer.from(await res.arrayBuffer()));
}
