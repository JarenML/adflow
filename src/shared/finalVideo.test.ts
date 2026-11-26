import { describe, expect, it } from 'vitest';
import { uploadedAs, videoContentType, type RemoteVideo } from './finalVideo';

const v = (over: Partial<RemoteVideo>): RemoteVideo => ({ id: 1, version: 1, size: 100, fileName: 'final.mp4', isCurrent: true, uploadedBy: 'Jaren', createdAt: '2026-11-26T16:10:00Z', ...over });

describe('final video', () => {
  it('knows which files the admin accepts', () => {
    expect(videoContentType('La fila de las 9.MP4')).toBe('video/mp4');
    expect(videoContentType('final.mov')).toBe('video/quicktime');
    expect(videoContentType('final.webm')).toBe('video/webm');
    expect(videoContentType('final.gif')).toBeNull();
    expect(videoContentType('final')).toBeNull();
  });

  it('recognizes a render that was already uploaded (same name and size)', () => {
    const videos = [v({ id: 2, version: 2, size: 200 }), v({ id: 1, version: 1, size: 100 })];
    expect(uploadedAs({ file: 'final.mp4', size: 100 }, videos)?.version).toBe(1);
    expect(uploadedAs({ file: 'final.mp4', size: 300 }, videos)).toBeNull();
    expect(uploadedAs({ file: 'otro.mp4', size: 200 }, videos)).toBeNull();
  });
});
