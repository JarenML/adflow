// What the brain is asked to do in each step. The rules come from the playbook (the slice of the
// master prompt for the step); these texts only add AdFlow's contract: which files to write and
// in which format, so the app can show them.
import type { EpisodeState, StepId } from '@shared/types';

export function systemPrompt(opts: {
  episode: EpisodeState;
  step: StepId;
  playbookName: string;
  playbookText: string;
  caseBlock: string;
}): string {
  return `# AdFlow · cerebro del episodio

Eres el cerebro de AdFlow, una app de escritorio que produce videos publicitarios cortos siguiendo un
playbook. Trabajas UN paso del pipeline a la vez, dentro de la carpeta del episodio (tu directorio de
trabajo). AdFlow muestra tus archivos de forma visual a una persona que aprueba o te pide cambios.

Reglas de AdFlow (además del playbook):
- Nunca generas imágenes, videos ni voces tú mismo y nunca ejecutas comandos: escribes los archivos que
  te pide el paso y AdFlow llama a los proveedores.
- No hagas preguntas: no hay nadie para responder dentro de esta ejecución. Si falta un dato que cambia
  el resultado, propón el valor más razonable según el caso y anótalo en "pendientes" de escenas.json.
- Los JSON deben ser válidos (UTF-8, sin comentarios). Respeta los nombres de archivo exactos.
- Escribe en español con ortografía impecable; los prompts para generadores van en inglés.
- Al terminar responde en 1–3 líneas qué hiciste (sin repetir el contenido de los archivos).
- Paso actual: ${opts.step}. Episodio: «${opts.episode.title}» (serie ${opts.episode.serie}).

# Playbook: ${opts.playbookName} (fragmento para este paso)

${opts.playbookText}

# Brief del episodio (de la fuente de episodios)

${opts.caseBlock || 'Sin brief: usa el título del episodio y propón lo que falte en "pendientes".'}
`;
}

const SCENE_FORMAT = `Formato de escenas.json (el mismo de los episodios anteriores):
{
  "serie": "…", "episodio": 1, "titulo": "…", "solucion": "Demo (ruta, s=…)",
  "formato": { "ancho": 720, "alto": 1280, "fps": 24, "escala_render": 1.5, "duracion_s": 47.5 },
  "sello": "Recreación",
  "voz": { "nombre": "…", "voice_id": "…", "proveedor": "…", "cierre": "narrador" },
  "frase": "…", "palabras_clave": ["…"], "etiquetas": ["…"], "enlace": "https://…",
  "bloque_estilo_imagen": "bloque de estilo común en inglés para todas las imágenes",
  "bloque_personajes": { "Nombre": "descripción física y vestimenta fija en inglés" },
  "escenarios": { "id_escenario": "descripción en inglés" },
  "pendientes": ["datos propuestos que la persona debe confirmar"],
  "escenas": [
    {
      "id": "S01", "inicio": 0, "fin": 3.2,
      "tipo": "real_clip | real_imagen | 2d_metafora | 2d_demo | 2d_flujo | 2d_decision | logo_estudio | escena_final",
      "imagen": "images-9x16/01.png (solo tipos real_*)",
      "locucion": { "quien": "Narrador", "tono": "[tense, low]", "texto": "solo las palabras que dice el narrador" },
      "dialogo": { "quien": "Sofía", "texto": "la frase del personaje, si habla en el clip (opcional)" },
      "texto_pantalla": ["…"],
      "descripcion": "qué se ve, en español",
      "prompt_imagen": "solo tipos real_*: la escena en inglés (el estilo y los personajes van en sus bloques)",
      "transicion_salida": "cómo nace el corte de un elemento en pantalla",
      "motor": "Firefly Veo 3.1 Fast 4 s | Remotion: imagen con push-in | Remotion 2D",
      "motivo": "por qué ese motor"
    }
  ]
}
Las escenas "logo" (tipo logo_estudio, 2.5 s, sin locución) y "final" (tipo escena_final, 6.36 s) van con
esos ids. "inicio" y "fin" son segundos acumulados y la suma total cumple la duración del playbook.
"locucion.texto" lleva únicamente lo que se locuta (AdFlow lo manda tal cual al generador de voz): nada
de notas, nombres de quien habla ni diálogos de personajes, que van en "dialogo". El logo no lleva
locución y la escena final deja "locucion" en null (su texto fijo lo pone la plantilla).`;

export function scriptPrompt(title: string, closingVoice: string): string {
  return `Paso 1 del playbook: guion y escenas del episodio «${title}».

Escribe en la carpeta actual:
1. guion.md — tabla segundo a segundo (tiempo, tipo real/2D, escena, locución, texto en pantalla), voces
   exactas con sus etiquetas de emoción, mapa de transiciones (incluido el puente al logo y su motivo) y
   plan de música y efectos.
2. escenas.json — exactamente con el formato de abajo.

Voz del cierre: ${closingVoice === 'template' ? 'la de la plantilla' : 'la del narrador del video'}.

${SCENE_FORMAT}`;
}

export function scriptFeedbackPrompt(message: string): string {
  return `La persona revisó el guion y pide este cambio:

"${message}"

Aplícalo en guion.md y escenas.json (mismo formato, tiempos recalculados). No cambies lo que no pidió.`;
}

export function scriptFixPrompt(errors: string): string {
  return `escenas.json no cumple el formato que AdFlow necesita:\n${errors}\nCorrígelo sin cambiar el contenido creativo.`;
}

export function imagesPrompt(): string {
  return `Paso 2 del playbook: prompts de imágenes.

Lee escenas.json y escribe prompts_imagenes.json con este formato:
{
  "imagenes": [
    {
      "escena": "S01",
      "archivo": "images-9x16/01.png",
      "prompt": "prompt completo en inglés, autosuficiente: bloque de estilo + personajes que aparecen (con su vestimenta completa) + escenario + la escena. Pide explícitamente vertical 9:16, 1080x1920.",
      "referencias": ["images-9x16/02.png"]
    }
  ]
}
- Una entrada por escena de tipo real_* (las 2D, el logo y el final no llevan imagen).
- Ordénalas para que cada personaje u objeto aparezca primero en una imagen sin referencias, y las
  siguientes usen como referencia esa imagen anterior (continuidad de caras, ropa y objetos).
- En "referencias" solo rutas relativas a imágenes de esta misma lista que van antes, o archivos que ya
  existan en ref/.
- Aplica las reglas del playbook para imágenes (texto en pantallas, sin logos inventados, Robly oficial).`;
}

export function imageFeedbackPrompt(sceneId: string | undefined, message: string): string {
  return sceneId
    ? `La persona revisó la imagen de la escena ${sceneId} y pide:\n\n"${message}"\n\nReescribe solo el prompt (y si hace falta las referencias) de ${sceneId} en prompts_imagenes.json. Si el cambio afecta la historia, ajusta también escenas.json.`
    : `La persona revisó las imágenes y pide:\n\n"${message}"\n\nAjusta los prompts afectados en prompts_imagenes.json y responde en la última línea, exactamente: ESCENAS: S01,S04 (las que hay que regenerar).`;
}

export function videosPrompt(): string {
  return `Pasos 3 y 4 del playbook: qué va con video de IA y sus prompts.

Lee escenas.json y prompts_imagenes.json. Elige las 2–3 escenas que necesitan clip (el gancho y los
diálogos) y escribe prompts_video.json:
{
  "clips": [
    {
      "escena": "S01",
      "imagen": "images-9x16/01.png",
      "archivo": "video/s01.mp4",
      "prompt": "prompt en inglés con el bloque fijo de reglas para clips, la vestimenta completa del personaje y, si hay diálogo, la frase en español entre comillas",
      "audio": false,
      "duracion_s": 4,
      "motivo": "por qué esta escena necesita movimiento real"
    }
  ]
}
Escribe además prompts_firefly.md con los mismos prompts legibles para quien los genere a mano.`;
}

export function videoFeedbackPrompt(sceneId: string | undefined, message: string): string {
  return `La persona revisó ${sceneId ? `el clip de ${sceneId}` : 'los clips'} y pide:\n\n"${message}"\n\nCorrige el prompt afectado en prompts_video.json y en prompts_firefly.md.`;
}

export function adCopyPrompt(): string {
  return `Paso de publicación: texto del anuncio.

Lee escenas.json y el brief. Escribe anuncio.md con este formato exacto (en español):

# Texto del anuncio
(2–4 líneas para el post o el anuncio: gancho, solución y llamada a la acción; usa la FRASE y las
ETIQUETAS del caso, que no van dentro del video; sin cifras de resultados ni promesas medibles)

# Titular
(una línea corta para el titular del anuncio)

# Enlace
(el ENLACE_DEL_ANUNCIO completo según los datos fijos de la serie, con su utm_content)

# utm_content
(solo el valor de utm_content)

# Hashtags
(3–6 hashtags, opcionales)`;
}

export function adCopyFeedbackPrompt(message: string): string {
  return `La persona revisó el texto del anuncio y pide:\n\n"${message}"\n\nAplícalo en anuncio.md sin cambiar el formato.`;
}
