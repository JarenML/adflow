// Keeps the local copy of the team playbook (master prompts, AdFlow config, templates, brand assets)
// in step with the admin. Only changed files are downloaded, each one checked against its hash; with
// no connection AdFlow keeps working with the last copy it has.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { PlaybookSyncStatus } from '@shared/types';
import { fetchPlaybookFile, fetchPlaybookManifest } from './sources/teamAdmin';
import { readTeamPlaybookState, teamPlaybookFiles, teamPlaybookStateFile, writeJson, type TeamPlaybookState } from './store';

const sha256 = (buf: Buffer) => createHash('sha256').update(buf).digest('hex');

/** The absolute path of a package file inside the copy; null for anything that would leave it. */
function inside(root: string, rel: string): string | null {
  const abs = path.resolve(root, rel);
  return abs.startsWith(path.resolve(root) + path.sep) ? abs : null;
}

export function teamPlaybookStatus(): PlaybookSyncStatus {
  const st = readTeamPlaybookState();
  return { version: st.manifest?.version, files: st.manifest?.files.length ?? 0, syncedAt: st.syncedAt, changed: st.changed, error: st.error, syncing: !!running };
}

let running: Promise<PlaybookSyncStatus> | null = null;

/** Downloads what changed. Never throws: problems end up in the status. */
export function syncTeamPlaybook(): Promise<PlaybookSyncStatus> {
  running ??= (async () => {
    const before = readTeamPlaybookState();
    try {
      const m = await fetchPlaybookManifest();
      const root = teamPlaybookFiles();
      let changed = 0;
      for (const f of m.files) {
        const abs = inside(root, f.path);
        if (!abs) continue;
        if (fs.existsSync(abs) && sha256(fs.readFileSync(abs)) === f.sha256) continue;
        const buf = await fetchPlaybookFile(f.path);
        if (sha256(buf) !== f.sha256) throw new Error(`${f.path} llegó incompleto; se reintenta en la próxima actualización.`);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(`${abs}.tmp`, buf);
        fs.renameSync(`${abs}.tmp`, abs);
        changed++;
      }
      // Files the admin no longer serves go away (only ones that came from it).
      const keep = new Set(m.files.map((f) => f.path));
      for (const f of before.manifest?.files ?? []) {
        const abs = inside(root, f.path);
        if (abs && !keep.has(f.path) && fs.existsSync(abs)) fs.rmSync(abs);
      }
      const next: TeamPlaybookState = { manifest: m, syncedAt: new Date().toISOString(), changed };
      writeJson(teamPlaybookStateFile(), next);
    } catch (err) {
      writeJson(teamPlaybookStateFile(), { ...before, error: String((err as Error)?.message ?? err) });
    }
    return { ...teamPlaybookStatus(), syncing: false };
  })().finally(() => {
    running = null;
  });
  return running;
}

/** Syncs when the copy is missing or older than `maxAgeMs`; otherwise returns at once. */
export async function ensureTeamPlaybook(maxAgeMs = 10 * 60_000): Promise<PlaybookSyncStatus> {
  const st = readTeamPlaybookState();
  const age = st.syncedAt ? Date.now() - Date.parse(st.syncedAt) : Infinity;
  if (st.manifest && age < maxAgeMs) return teamPlaybookStatus();
  return syncTeamPlaybook();
}
