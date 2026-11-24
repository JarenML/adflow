// Contracts of the files the brain writes in each episode folder. They follow the format the
// Robles.AI episodes already use (escenas.json), so an episode made by hand and one made with
// AdFlow are interchangeable. Unknown fields are kept (passthrough).
import { z } from 'zod';

const textList = z.union([z.array(z.string()), z.string()]).optional();

export const narrationSchema = z
  .object({
    quien: z.string().default('Narrador'),
    tono: z.string().optional().default(''),
    texto: z.string().default(''),
  })
  .passthrough();

export const sceneSchema = z
  .object({
    id: z.string(),
    inicio: z.number().optional(),
    fin: z.number().optional(),
    duracion_s: z.number().optional(),
    tipo: z.string(),
    imagen: z.string().optional(),
    locucion: z.union([narrationSchema, z.string(), z.null()]).optional(),
    texto_pantalla: textList,
    descripcion: z.string().optional(),
    prompt_imagen: z.string().optional(),
    transicion_salida: z.string().optional(),
    motor: z.string().optional(),
    motivo: z.string().optional(),
  })
  .passthrough();

export const scriptSchema = z
  .object({
    serie: z.string().optional(),
    episodio: z.union([z.number(), z.string()]).optional(),
    titulo: z.string().optional(),
    solucion: z.string().optional(),
    formato: z.record(z.string(), z.unknown()).optional(),
    voz: z.unknown().optional(),
    bloque_estilo_imagen: z.string().optional(),
    bloque_personajes: z.unknown().optional(),
    escenarios: z.unknown().optional(),
    pendientes: z.array(z.string()).optional(),
    escenas: z.array(sceneSchema).min(1),
  })
  .passthrough();

export type Scene = z.infer<typeof sceneSchema>;
export type Script = z.infer<typeof scriptSchema>;

export const imagePromptsSchema = z.object({
  imagenes: z
    .array(
      z.object({
        escena: z.string(),
        archivo: z.string(),
        prompt: z.string().min(20),
        referencias: z.array(z.string()).default([]),
      }),
    )
    .min(1),
});
export type ImagePrompts = z.infer<typeof imagePromptsSchema>;

export const videoPromptsSchema = z.object({
  clips: z
    .array(
      z.object({
        escena: z.string(),
        imagen: z.string(),
        archivo: z.string(),
        prompt: z.string().min(20),
        audio: z.boolean().default(false),
        duracion_s: z.number().default(4),
        motivo: z.string().default(''),
      }),
    )
    // Empty when the script has no clip scenes (AdFlow writes it; Claude never does).
    .max(6),
});
export type VideoPrompts = z.infer<typeof videoPromptsSchema>;

/** Seconds a scene lasts, from duracion_s or inicio/fin. */
export function sceneDuration(s: Scene): number {
  if (typeof s.duracion_s === 'number') return s.duracion_s;
  if (typeof s.inicio === 'number' && typeof s.fin === 'number') return Math.max(0, s.fin - s.inicio);
  if (s.tipo.startsWith('logo')) return 2.5;
  if (s.tipo.includes('final')) return 6.36;
  return 0;
}

export function sceneNarration(s: Scene): { who: string; tone: string; text: string } | null {
  const l = s.locucion;
  if (!l) return null;
  if (typeof l === 'string') return l.trim() ? { who: 'Narrador', tone: '', text: l } : null;
  return l.texto?.trim() ? { who: l.quien ?? 'Narrador', tone: l.tono ?? '', text: l.texto } : null;
}

export function screenTexts(s: Scene): string[] {
  const t = s.texto_pantalla;
  if (!t) return [];
  return Array.isArray(t) ? t : [t];
}

/** Longest a clip scene may last in the script: the clips are generated at 4 s. */
export const MAX_CLIP_S = 4;

/** Clip scenes of the script that last longer than MAX_CLIP_S, as problems for the brain to fix. */
export function longClipProblems(script: Script): string[] {
  return script.escenas
    .filter((s) => isClipScene(s) && sceneDuration(s) > MAX_CLIP_S + 0.05)
    .map((s) => `${s.id}: es real_clip y dura ${sceneDuration(s).toFixed(2)} s; un clip dura como máximo ${MAX_CLIP_S} s.`);
}

export type SceneKind = 'real' | '2d' | 'logo' | 'final' | 'other';

/**
 * Whether the script decided this scene is an AI video clip (tipo real_clip). The script is the only
 * place that decides it: Videos takes exactly these scenes, and adding or removing a clip there
 * changes the scene's tipo in escenas.json.
 */
export function isClipScene(s: { tipo: string }): boolean {
  const t = s.tipo.toLowerCase();
  return t.startsWith('real') && t.includes('clip');
}

export function sceneKind(tipo: string): SceneKind {
  const t = tipo.toLowerCase();
  if (t.startsWith('logo')) return 'logo';
  if (t.includes('final')) return 'final';
  if (t.startsWith('2d')) return '2d';
  if (t.startsWith('real')) return 'real';
  return 'other';
}

export interface ScriptCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
}
