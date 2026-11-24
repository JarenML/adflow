// What the brain is asked to do in each step. The rules come from the playbook (the slice of the
// master prompt for the step); these texts only add AdFlow's contract: which files to write and
// in which format, so the app can show them.
import type { EpisodeState, StepId } from '@shared/types';

export function systemPrompt(opts: {
  episode: EpisodeState;
  step: StepId;
  playbookName: string;
  playbookText: string;
  /** Folder that holds the playbook's files (the paths the playbook mentions are relative to it). */
  playbookDir?: string;
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
- Las rutas del playbook (creative/social/…, public/robly-avatar/…) están dentro de
  ${opts.playbookDir || 'la carpeta del playbook'}; puedes leerlas, nunca escribas ahí.
- No leas PROMPT_MAESTRO_CASOS.md (el brief de abajo ya es el caso), ni la carpeta .adflow/ (estado
  interno de AdFlow), ni busques código ni textos del sitio: las demos se recrean con textos breves
  escritos para el video. No explores de más: lee lo que el paso necesita y escribe.
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

Qué escenas son clip de video lo decides aquí y es definitivo (AdFlow genera exactamente esas): tipo
real_clip solo para el gancho y las escenas donde un personaje habla («dialogo»); las demás escenas
reales son real_imagen. No hay clips opcionales: si dudas, es real_imagen.

El brief es solo una referencia (problema y solución): tú creas el gancho, las escenas y los
personajes (nombre, edad y vestimenta fija en bloque_personajes). Si la serie ya tiene episodios
anteriores en la carpeta de episodios, reutiliza sus personajes. La frase, las etiquetas y el enlace
del anuncio no van en el video (se escriben en Publicación).

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

/** A scene the script made a clip, as AdFlow passes it to the brain. */
export interface ClipScene {
  id: string;
  image: string;
  /** The character's line, when the scene has dialogue (the clip then carries audio). */
  dialogue?: string;
}

const CLIP_FORMAT = (example: ClipScene) => `{
  "clips": [
    {
      "escena": "${example.id}",
      "imagen": "${example.image}",
      "archivo": "video/${example.id.toLowerCase()}.mp4",
      "prompt": "prompt en inglés con el bloque fijo de reglas para clips, la vestimenta completa del personaje y, si hay diálogo, la frase en español entre comillas",
      "audio": ${example.dialogue ? 'true' : 'false'},
      "duracion_s": 4,
      "motivo": "una frase corta: por qué esta escena necesita movimiento real"
    }
  ]
}`;

const clipLine = (s: ClipScene) => `- ${s.id} · ${s.image} · ${s.dialogue ? `con diálogo (audio true): «${s.dialogue}»` : 'sin diálogo (audio false)'}`;

/** Paso 4: the clips are already decided by the script; the brain only writes their prompts. */
export function videosPrompt(scenes: ClipScene[]): string {
  return `Paso 4 del playbook: prompts de los clips de video.

Qué escenas llevan clip ya lo decidió el guion (tipo real_clip en escenas.json); no lo vuelvas a decidir.
Escribe el prompt de exactamente estas escenas, ni una más ni una menos:
${scenes.map(clipLine).join('\n')}

Lee escenas.json (lo que pasa en cada escena) y prompts_imagenes.json (personajes y vestimenta) y escribe
prompts_video.json con una entrada por escena de la lista, en ese orden:
${CLIP_FORMAT(scenes[0])}
Escribe además prompts_firefly.md con los mismos prompts legibles para quien los genere a mano.
No cambies escenas.json ni otros archivos.`;
}

/** The person turned one more scene into a clip: write only its prompt. */
export function videoAddPrompt(scene: ClipScene): string {
  return `La persona decidió que la escena ${scene.id} también lleva clip de video (ya es tipo real_clip en
escenas.json).

${clipLine(scene)}

Agrega su entrada a prompts_video.json (no cambies las demás) y su sección a prompts_firefly.md, con el
mismo formato:
${CLIP_FORMAT(scene)}
No cambies escenas.json ni otros archivos.`;
}

export function videoFeedbackPrompt(sceneId: string | undefined, message: string): string {
  return `La persona revisó ${sceneId ? `el clip de ${sceneId}` : 'los clips'} y pide:\n\n"${message}"\n\nCorrige el prompt afectado en prompts_video.json y en prompts_firefly.md. No agregues ni quites clips: eso lo decide el guion.`;
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

export function renderPrompt(material: string): string {
  return `Pasos 8 y 9 del playbook: ensamblar el video final en Remotion.

Tu directorio de trabajo es el proyecto Remotion del episodio (ya instalado). La carpeta del episodio
(escenas.json, guion.md, prompts_video.json) está un nivel arriba (..).

Haz el montaje completo según escenas.json y el playbook:
- src/Root.tsx: la composición "Video" (no cambies su id ni el script de render) con todas las
  escenas, sus duraciones (voz + retraso + 0,1–0,25 s), transiciones del mapa, puente al logo,
  <EscenaLogo /> y <EscenaFinal /> de las plantillas. Total dentro de la duración del playbook.
- src/voz.tsx: registra las tomas de public/voz/ y en qué escena va cada una, con subtítulos.
- src/audio.tsx: efectos de public/sfx/ y música (si no hay, MUSIC_FILE = null).
- Escenas 2D: créalas en src/scenes/ reutilizando las piezas de ui.tsx, flat.tsx y los ejemplos.
- Imágenes: staticFile('escenas/…'); clips: staticFile('clips/…'). Una escena real sin clip usa la
  imagen con Still (acercamiento y paneo).

Puedes revisar tu trabajo con \`npx remotion still src/index.ts <composición> out/check.png --frame=N\`
y \`npx tsc --noEmit\`. No ejecutes npm install ni el render completo: AdFlow lo hace después.
Si falta material (una voz o un clip), arma la escena con lo que hay y dilo en tu respuesta.

${material}`;
}

export function renderFeedbackPrompt(message: string): string {
  return `La persona vio el video renderizado y pide este cambio:

"${message}"

Aplícalo sobre el mismo proyecto (no cambies lo que no pidió). AdFlow vuelve a renderizar al terminar.`;
}

export function renderFixPrompt(error: string): string {
  return `El render de Remotion falló con este error:

${error}

Corrige el proyecto para que renderice sin cambiar el contenido creativo.`;
}
