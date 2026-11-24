import { describe, expect, it } from 'vitest';
import { isClipScene, videoPromptsSchema } from './schemas';

describe('isClipScene: the script decides which scenes are video clips', () => {
  it('only real_clip scenes are clips', () => {
    expect(isClipScene({ tipo: 'real_clip' })).toBe(true);
    expect(isClipScene({ tipo: 'Real_Clip' })).toBe(true);
    expect(isClipScene({ tipo: 'real_imagen' })).toBe(false);
    expect(isClipScene({ tipo: '2d_demo' })).toBe(false);
    expect(isClipScene({ tipo: 'logo_estudio' })).toBe(false);
    expect(isClipScene({ tipo: 'escena_final' })).toBe(false);
  });

  it('a script without clips has an empty clip list', () => {
    expect(videoPromptsSchema.safeParse({ clips: [] }).success).toBe(true);
  });
});
