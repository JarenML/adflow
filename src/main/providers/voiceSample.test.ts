import { describe, expect, it } from 'vitest';
import { isElevenSampleUrl } from './voices';

describe('isElevenSampleUrl: only ElevenLabs voice samples are downloaded', () => {
  it('accepts the three places ElevenLabs keeps samples', () => {
    expect(isElevenSampleUrl('https://storage.googleapis.com/eleven-public-prod/premade/voices/abc/sample.mp3')).toBe(true);
    expect(isElevenSampleUrl('https://storage.googleapis.com/eleven-public-prod/database/user/abc/voices/def/sample.mp3')).toBe(true);
    expect(isElevenSampleUrl('https://api.us.elevenlabs.io/v1/voices/abc/previews/audio?payload=xyz')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isElevenSampleUrl('https://storage.googleapis.com/otro-bucket/sample.mp3')).toBe(false);
    expect(isElevenSampleUrl('http://api.elevenlabs.io/v1/voices/abc')).toBe(false);
    expect(isElevenSampleUrl('https://elevenlabs.io.evil.com/sample.mp3')).toBe(false);
    expect(isElevenSampleUrl('file:///C:/Windows/win.ini')).toBe(false);
    expect(isElevenSampleUrl('no es una url')).toBe(false);
  });
});
