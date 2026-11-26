import type { Job, Stage } from '../api';

export type StageState = 'done' | 'active' | 'failed' | 'pending';

/** How each pipeline stage should look for a job: finished, running, where it stopped, or still ahead. */
export function stageStates(job: Pick<Job, 'status' | 'stage'>, stages: Pick<Stage, 'key'>[]): StageState[] {
  const current = job.stage ? stages.findIndex((s) => s.key === job.stage) : -1;
  return stages.map((_, index) => {
    if (job.status === 'done' || index < current) return 'done';
    if (index === current) {
      if (job.status === 'running') return 'active';
      if (job.status === 'failed' || job.status === 'cancelled') return 'failed';
    }
    return 'pending';
  });
}
