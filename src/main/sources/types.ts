// An episode source tells AdFlow which episodes exist and hears about their progress.
// The pipeline and the UI only talk to this interface, never to a specific source.
import type { EpisodeSourceInfo, Playbook, SourceEpisode, TeamProgress } from '@shared/types';

export interface EpisodeSource extends EpisodeSourceInfo {
  /** Every episode the source knows, with its team status. */
  list(playbook: Playbook): Promise<SourceEpisode[]>;
  /** What the brain needs to write the script (characters, before/after, phrase…). */
  brief(playbook: Playbook, episodeId: string): Promise<string>;
  /** "I'm taking this one": assigns it to the person so nobody duplicates it. */
  claim(playbook: Playbook, episodeId: string, user: string): Promise<void>;
  /** Called after every change of a local episode (see shared/progress.ts). */
  report(playbook: Playbook, episodeId: string, progress: TeamProgress, user: string): Promise<void>;
}
