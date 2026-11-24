// Manual check: `ELEVEN_KEY=... npx tsx scripts/try-voice-sample.ts <out dir>` downloads one free sample
// from each place ElevenLabs keeps them, and shows the account's used credits before and after.
import { voiceSample } from '../src/main/providers/voices';

void (async () => {
  const key = process.env.ELEVEN_KEY!;
  const used = async () => ((await (await fetch('https://api.elevenlabs.io/v1/user/subscription', { headers: { 'xi-api-key': key } })).json()) as { character_count: number }).character_count;
  const before = await used();
  const { voices } = (await (await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': key } })).json()) as { voices: { voice_id: string; name: string; preview_url: string }[] };
  for (const kind of ['/premade/', '/database/', 'elevenlabs.io']) {
    const v = voices.find((x) => x.preview_url?.includes(kind));
    if (!v) continue;
    const file = await voiceSample(process.argv[2], v.voice_id, v.preview_url);
    console.log(`${kind} · ${v.name} → ${file}`);
  }
  console.log(`créditos usados antes ${before}, después ${await used()}`);
})();
