import { PriorityQueue } from "./priority";
import type { JobRun } from "../types";

export interface QueueStats {
  pending: number;
  claimed: number;
  oldestScheduledFor: number | null;
}

/**
 * In-process run queue.
 *
 * Runs become claimable once `scheduledFor` has passed. A claim holds the
 * run for `visibilityTimeoutMs`; if the worker neither finishes nor
 * heartbeats within that window the run becomes claimable again so a
 * crashed worker does not strand it.
 */
export class MemoryQueue {
  private ready: PriorityQueue<JobRun>;
  private claimed = new Map<string, JobRun>();

  constructor(private readonly now: () => number = () => Date.now()) {
    this.ready = new PriorityQueue<JobRun>((a, b) => a.scheduledFor - b.scheduledFor);
  }

  enqueue(run: JobRun): void {
    this.ready.push(run);
  }

  /** Take the next due run, or undefined when nothing is ready. */
  claim(workerId: string, visibilityTimeoutMs: number): JobRun | undefined {
    this.recoverExpiredClaims();

    const head = this.ready.peek();
    if (!head || head.scheduledFor > this.now()) {
      return undefined;
    }

    const run = this.ready.pop()!;
    run.state = "claimed";
    run.claimedAt = this.now();
    run.claimedBy = workerId;
    run.visibleAt = this.now() + visibilityTimeoutMs;

    this.claimed.set(run.id, run);
    return run;
  }

  /** Push the visibility deadline out for a run still in progress. */
  heartbeat(runId: string, visibilityTimeoutMs: number): void {
    const run = this.claimed.get(runId);
    if (!run) return;
    run.visibleAt = this.now() + visibilityTimeoutMs;
  }

  /** Drop a run from the claimed set once it has settled. */
  release(runId: string): void {
    this.claimed.delete(runId);
  }

  /** Put a run back on the queue, typically for a retry. */
  requeue(run: JobRun, scheduledFor: number): void {
    this.claimed.delete(run.id);
    run.state = "pending";
    run.scheduledFor = scheduledFor;
    run.claimedAt = null;
    run.claimedBy = null;
    run.visibleAt = null;
    this.ready.push(run);
  }

  /** Take back claims whose visibility window lapsed. */
  recoverExpiredClaims(): number {
    const now = this.now();
    let recovered = 0;

    for (const [id, run] of this.claimed) {
      if (run.visibleAt !== null && run.visibleAt <= now) {
        this.claimed.delete(id);
        run.state = "pending";
        run.claimedBy = null;
        run.claimedAt = null;
        run.visibleAt = null;
        this.ready.push(run);
        recovered++;
      }
    }

    return recovered;
  }

  stats(): QueueStats {
    const head = this.ready.peek();
    return {
      pending: this.ready.size,
      claimed: this.claimed.size,
      oldestScheduledFor: head ? head.scheduledFor : null,
    };
  }

  /** Remove every queued run belonging to a job. */
  purgeJob(jobId: string): number {
    let removed = 0;
    while (this.ready.remove((run) => run.jobId === jobId)) {
      removed++;
    }
    for (const [id, run] of this.claimed) {
      if (run.jobId === jobId) {
        this.claimed.delete(id);
        removed++;
      }
    }
    return removed;
  }

  clear(): void {
    this.ready.clear();
    this.claimed.clear();
  }
}
