import { describe, expect, it } from 'vitest';
import { uploadedAs, versionsOf, videoContentType, type RemoteVideo } from './finalVideo';

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

describe('versions with formats', () => {
  it('groups the files of one upload into a version, older ones counting as 9:16', () => {
    const rows = [
      v({ id: 3, version: 2, format: '4x5', isCurrent: true }),
      v({ id: 2, version: 2, format: '9x16', isCurrent: true }),
      v({ id: 1, version: 1, format: undefined, isCurrent: false }),
    ];
    expect(versionsOf(rows)).toEqual([
      { version: 2, isCurrent: true, createdAt: rows[0].createdAt, formats: ['4x5', '9x16'] },
      { version: 1, isCurrent: false, createdAt: rows[2].createdAt, formats: ['9x16'] },
    ]);
  });
});
