// Every connection AdFlow knows about. A provider that spends credits is listed (so the person
// can see and choose it) but stays blocked until it is implemented and paid providers are allowed.
import type { Capability, ProviderInfo } from '@shared/types';
import { CLIP_S, clipCredits, videoModelFor } from '@shared/videoModels';

export const PROVIDERS: ProviderInfo[] = [
  // Brain
  {
    id: 'claude-cli',
    capability: 'brain',
    name: 'Claude Code',
    description: 'Coordina el episodio con la cuenta de Claude Code de esta computadora.',
    billing: 'subscription',
    implemented: true,
    costNote: 'Incluido en tu suscripción de Claude (consume su límite de uso).',
  },
  // Images
  {
    id: 'codex-cli',
    capability: 'image',
    name: 'Codex (generador de imágenes)',
    description: 'Usa `codex exec` con la herramienta de imágenes de la cuenta de Codex de esta computadora.',
    billing: 'subscription',
    implemented: true,
    costNote: 'Incluido en tu plan de Codex · ~1 min por imagen.',
  },
  {
    id: 'openai-images',
    capability: 'image',
    name: 'OpenAI Images API',
    description: 'gpt-image por API, con imágenes de referencia.',
    billing: 'credits',
    implemented: false,
    secret: 'openai',
    costNote: 'Se cobra por imagen en tu cuenta de OpenAI.',
  },
  {
    id: 'firefly-image',
    capability: 'image',
    name: 'Adobe Firefly',
    description: 'Imágenes y expansión a 9:16 con Firefly.',
    billing: 'credits',
    implemented: false,
    costNote: 'Créditos generativos de Adobe.',
  },
  // Video
  {
    id: 'manual',
    capability: 'video',
    name: 'Subir clips a mano',
    description: 'Genera el clip con la herramienta que prefieras (Firefly, Flow, Gemini…) y súbelo aquí.',
    billing: 'manual',
    implemented: true,
    costNote: 'Se paga en la herramienta que uses.',
  },
  {
    id: 'firefly-veo',
    capability: 'video',
    name: 'Firefly · Veo 3.1 Fast',
    description: 'Imagen como primer fotograma, 9:16, 1080p, 24 fps.',
    billing: 'credits',
    implemented: false,
    costNote: 'Créditos generativos de Adobe por clip.',
  },
  {
    id: 'elevenlabs-mcp',
    capability: 'video',
    name: 'ElevenLabs MCP',
    description:
      'Claude genera cada clip con el conector de ElevenLabs de tu cuenta de Claude: sube la imagen de la escena como primer fotograma y usa el modelo Veo que elijas, 9:16. Funciona con cualquier plan de ElevenLabs que incluya Image & Video (desde Free).',
    billing: 'credits',
    implemented: true,
    costNote: 'Créditos de ElevenLabs por clip según el modelo (Veo 3.1 Fast ≈ 3,640 por clip de 4 s). Conecta ElevenLabs en claude.ai → Connectors.',
  },
  {
    id: 'elevenlabs-video',
    capability: 'video',
    name: 'ElevenLabs API',
    description: 'API de imagen y video de ElevenLabs con el modelo Veo que elijas: la imagen de la escena como primer fotograma, 9:16.',
    billing: 'credits',
    implemented: true,
    secret: 'elevenlabs',
    minPlan: 'Pro',
    costNote: 'Créditos de ElevenLabs por clip (plan Pro o superior para la API de video).',
  },
  {
    id: 'heygen-video',
    capability: 'video',
    name: 'HeyGen · imagen a video',
    description: 'Clips de 5–15 s desde una imagen.',
    billing: 'credits',
    implemented: false,
    secret: 'heygen',
    costNote: 'Créditos premium del plan de HeyGen.',
  },
  {
    id: 'higgsfield',
    capability: 'video',
    name: 'Higgsfield',
    description: 'Video generativo con control de cámara.',
    billing: 'credits',
    implemented: false,
    secret: 'higgsfield',
    costNote: 'Créditos de Higgsfield por clip.',
  },
  // Voice
  {
    id: 'windows-sapi',
    capability: 'voice',
    name: 'Voces de Windows',
    description: 'Voces instaladas en el sistema, útiles como voz provisional para ajustar tiempos.',
    billing: 'free',
    implemented: true,
    costNote: 'Gratis y sin conexión.',
  },
  {
    id: 'edge-tts',
    capability: 'voice',
    name: 'Edge TTS',
    description: 'Voces neuronales gratuitas de Microsoft (necesita `pip install edge-tts`).',
    billing: 'free',
    implemented: true,
    costNote: 'Gratis.',
  },
  {
    id: 'elevenlabs',
    capability: 'voice',
    name: 'ElevenLabs API',
    description: 'Voz principal del playbook (eleven_v3, con sus etiquetas de emoción).',
    billing: 'credits',
    implemented: true,
    secret: 'elevenlabs',
    costNote: '1 crédito por carácter (eleven_v3): un video completo ≈ 400–600 créditos. Con límite por ejecución.',
  },
  {
    id: 'heygen-voice',
    capability: 'voice',
    name: 'HeyGen MCP',
    description:
      'Voces de HeyGen a través de Claude Code, sin clave de API en AdFlow. Incluye catálogo con muestras gratuitas.',
    billing: 'credits',
    implemented: true,
    costNote: 'Cuota de voz de tu plan de HeyGen; AdFlow mide los créditos premium antes y después de cada ejecución.',
  },
  {
    id: 'openai-tts',
    capability: 'voice',
    name: 'OpenAI TTS',
    description: 'Voz con dirección de actuación por frase.',
    billing: 'credits',
    implemented: false,
    secret: 'openai',
    costNote: 'Se cobra por carácter en tu cuenta de OpenAI.',
  },
  // Music
  {
    id: 'elevenlabs-music',
    capability: 'music',
    name: 'ElevenLabs API',
    description: 'Pista instrumental hecha a la medida del montaje: tensión, logo, solución, drop y cierre. Se genera en Render final, después de que Claude arma el video.',
    billing: 'credits',
    implemented: true,
    secret: 'elevenlabs',
    costNote: '≈ 4 créditos por segundo (≈ 200 por 50 s). Si el montaje no cambia, se reutiliza sin volver a cobrar.',
  },
  {
    id: 'claude-music',
    capability: 'music',
    name: 'Claude',
    description: 'Claude Code la escribe en código al armar el video en Remotion (playbook §4, opción 3), calzada a sus tiempos; AdFlow la genera con Python.',
    billing: 'subscription',
    implemented: true,
    costNote: 'Incluido en tu suscripción de Claude (consume su límite de uso).',
  },
  {
    id: 'none',
    capability: 'music',
    name: 'Sin música',
    description: 'El video sale sin música (solo voces y efectos).',
    billing: 'free',
    implemented: true,
    costNote: 'Gratis.',
  },
];

export function providersFor(cap: Capability): ProviderInfo[] {
  return PROVIDERS.filter((p) => p.capability === cap);
}

export function provider(id: string): ProviderInfo | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

export const SECRET_LABELS: Record<string, string> = {
  elevenlabs: 'ElevenLabs API key',
  heygen: 'HeyGen API key',
  openai: 'OpenAI API key',
  higgsfield: 'Higgsfield API key',
};

/** Rough spend for an action, shown before the person confirms it. */
export function estimate(providerId: string, units: number, model?: string): string {
  const p = provider(providerId);
  if (!p) return '';
  switch (providerId) {
    case 'codex-cli':
      return `${units} imagen${units === 1 ? '' : 'es'} · incluido en Codex · ~${units} min`;
    case 'elevenlabs':
      // units = characters of the narration (1 credit each with eleven_v3).
      return `≈ ${units.toLocaleString('es-PE')} créditos (1 por carácter, una toma por frase)`;
    case 'elevenlabs-mcp':
    case 'elevenlabs-video':
      return `${units} clip${units === 1 ? '' : 's'} de ${CLIP_S} s · ≈ ${(units * clipCredits(videoModelFor(providerId, model).id)).toLocaleString('es-PE')} créditos con ${videoModelFor(providerId, model).label}`;
    case 'windows-sapi':
    case 'edge-tts':
      return `${units} frases · gratis`;
    case 'manual':
      return `${units} clip${units === 1 ? '' : 's'} · generación externa`;
    default:
      return `${units} × ${p.costNote}`;
  }
}
