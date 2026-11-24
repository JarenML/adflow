// Manual check of the ElevenLabs MCP recipe: `npx tsx scripts/try-mcp-clip.ts <episode dir> [--run]`.
// Without --run it stops at the estimate (no credits spent).
import path from 'node:path';
import { mcpClip } from '../src/main/providers/elevenlabsMcp';

const [dir, flag] = process.argv.slice(2);
if (!dir) throw new Error('Uso: npx tsx scripts/try-mcp-clip.ts <carpeta del episodio> [--run]');

void (async () => {
const res = await mcpClip({
  dir,
  sceneId: 'S01',
  image: 'images-9x16/01.png',
  file: 'video/s01-prueba.mp4',
  prompt:
    'Vertical 9:16 photorealistic, 1080x1920. Keep the person\'s face, hair and clothes identical to the reference image. From the very first frame she is already recording a voice message with the phone close to her mouth; she stumbles, sighs and lowers the phone. Only Milagros speaks, in Latin American Spanish, lip-synced: "Después de tu sesión, recuerda… ay, otra vez." Nobody else speaks. Do not add captions, subtitles, logos, watermarks or any new text. Very slow push-in only. Photorealistic only.',
  durationS: 4,
  resolution: '1080p',
  audio: true,
  flowName: `Prueba AdFlow · ${path.basename(dir)} · S01`,
  estimateOnly: flag !== '--run',
  onEvent: (e) => console.log(`[${e.kind}] ${e.text}`),
});
console.log(JSON.stringify(res, null, 2));
})();
