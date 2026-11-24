// Manual check: `npx tsx scripts/try-voice-by-id.ts <data dir> <provider> <voice id>` looks a voice up
// by its ID (free) the way the voice step does, with an empty or existing catalog cache.
import { voiceById } from '../src/main/providers/voices';

void (async () => {
  const [dataDir, provider, id] = process.argv.slice(2);
  const t = Date.now();
  try {
    const v = await voiceById(provider, id, { elevenlabs: process.env.ELEVEN_KEY ?? '' }, { dataDir });
    console.log(JSON.stringify(v), `${((Date.now() - t) / 1000).toFixed(0)} s`);
  } catch (e) {
    console.log('ERROR', (e as Error).message);
  }
})();
