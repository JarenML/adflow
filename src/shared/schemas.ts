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
    .min(1)
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

export type SceneKind = 'real' | '2d' | 'logo' | 'final' | 'other';

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

/** Acceptance criteria of step 1 in the Robles.AI playbook (§1 and §2 paso 1). */
export function checkScript(script: Script): ScriptCheck[] {
  const scenes = script.escenas;
  const total = scenes.reduce((sum, s) => sum + sceneDuration(s), 0);
  const kinds = scenes.map((s) => sceneKind(s.tipo));
  const twoD = kinds.filter((k) => k === '2d').length;
  const first = scenes[0];
  const allText = JSON.stringify(scenes).toLowerCase();
  return [
    {
      id: 'duration',
      label: 'Duración 40–50 s',
      ok: total >= 40 && total <= 50,
      detail: `${total.toFixed(1)} s en total`,
    },
    {
      id: 'hook',
      label: 'Gancho con video real',
      ok: !!first && first.tipo.toLowerCase().includes('clip'),
      detail: first ? `${first.id}: ${first.tipo}` : 'Sin escenas',
    },
    {
      id: 'twoD',
      label: '3–4 animaciones 2D',
      ok: twoD >= 3 && twoD <= 4,
      detail: `${twoD} escenas 2D`,
    },
    {
      id: 'logo',
      label: 'Logo intermedio después del problema',
      ok: kinds.includes('logo'),
      detail: kinds.includes('logo') ? 'Incluido' : 'Falta la escena logo_estudio',
    },
    {
      id: 'final',
      label: 'Escena final estándar',
      ok: kinds[kinds.length - 1] === 'final',
      detail: kinds[kinds.length - 1] === 'final' ? 'Al final' : 'Debe ser la última escena',
    },
    {
      id: 'robly',
      label: 'Robly presente',
      ok: allText.includes('robly'),
      detail: allText.includes('robly') ? 'Aparece' : 'No aparece en ninguna escena',
    },
    {
      id: 'decision',
      label: 'Una persona decide',
      ok: /decisi|confirma|decide/.test(allText),
      detail: /decisi|confirma|decide/.test(allText) ? 'Hay una decisión humana' : 'No se ve quién decide',
    },
  ];
}
