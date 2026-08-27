import { randomUUID } from "node:crypto";
import type { JobDefinition, JobRun, JobState } from "../types";

export interface RunFilter {
  jobId?: string;
  state?: JobState;
  since?: number;
  limit?: number;
}

/** In-memory run history. Retains the last `capacity` runs per job. */
export class RunStore {
  private runs = new Map<string, JobRun>();
  private byJob = new Map<string, string[]>();

  constructor(private readonly capacity = 200) {}

  create(job: JobDefinition, scheduledFor: number, attempt = 1): JobRun {
    const run: JobRun = {
      id: randomUUID(),
      jobId: job.id,
      attempt,
      state: "pending",
      scheduledFor,
      claimedAt: null,
      claimedBy: null,
      startedAt: null,
      finishedAt: null,
      visibleAt: null,
      output: null,
      error: null,
    };

    this.runs.set(run.id, run);

    const ids = this.byJob.get(job.id) ?? [];
    ids.push(run.id);
    this.byJob.set(job.id, ids);
    this.trim(job.id);

    return run;
  }

  get(id: string): JobRun | undefined {
    return this.runs.get(id);
  }

  update(id: string, patch: Partial<JobRun>): JobRun {
    const run = this.runs.get(id);
    if (!run) throw new Error(`no run ${id}`);
    Object.assign(run, patch);
    return run;
  }

  /** Latest run for a job, by creation order. */
  latest(jobId: string): JobRun | undefined {
    const ids = this.byJob.get(jobId);
    if (!ids || ids.length === 0) return undefined;
    return this.runs.get(ids[ids.length - 1]);
  }

  /**
   * True when the job has a run that has not settled.
   *
   * `exceptRunId` skips one run, so a run can ask whether any *other*
   * attempt of the same job is still in flight.
   */
  hasActiveRun(jobId: string, exceptRunId?: string): boolean {
    const ids = this.byJob.get(jobId) ?? [];
    for (const id of ids) {
      if (id === exceptRunId) continue;
      const run = this.runs.get(id);
      if (run && (run.state === "claimed" || run.state === "running")) return true;
    }
    return false;
  }

  list(filter: RunFilter = {}): JobRun[] {
    let out = [...this.runs.values()];
    if (filter.jobId) out = out.filter((r) => r.jobId === filter.jobId);
    if (filter.state) out = out.filter((r) => r.state === filter.state);
    if (filter.since) out = out.filter((r) => r.scheduledFor >= filter.since!);
    out.sort((a, b) => b.scheduledFor - a.scheduledFor);
    return out.slice(0, filter.limit ?? 50);
  }

  private trim(jobId: string): void {
    const ids = this.byJob.get(jobId)!;
    while (ids.length > this.capacity) {
      const oldest = ids.shift()!;
      this.runs.delete(oldest);
    }
  }

  get size(): number {
    return this.runs.size;
  }
}
