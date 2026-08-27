import { EventEmitter } from "node:events";
import { DEFAULT_OPTIONS, type JobDefinition, type JobRun, type SchedulerOptions } from "./types";
import { JobStore, type CreateJobInput } from "./store/jobs";
import { RunStore } from "./store/runs";
import { MemoryQueue } from "./queue/memory-queue";
import { HandlerRegistry } from "./registry";
import { Metrics } from "./metrics";
import { Worker } from "./worker";
import { backoffMs, shouldRetry } from "./backoff";
import { nextRun } from "./cron/next";

export interface SchedulerStats {
  running: boolean;
  inFlight: number;
  jobs: number;
  queue: ReturnType<MemoryQueue["stats"]>;
  metrics: ReturnType<Metrics["snapshot"]>;
}

/**
 * Ties everything together: decides when a job is due, enqueues runs, hands
 * them to workers, and reschedules on failure or on the next cron tick.
 */
export class Scheduler extends EventEmitter {
  readonly jobs = new JobStore();
  readonly runs = new RunStore();
  readonly registry = new HandlerRegistry();
  readonly metrics = new Metrics();

  private readonly queue: MemoryQueue;
  private readonly worker: Worker;
  private readonly options: SchedulerOptions;

  private timer: NodeJS.Timeout | null = null;
  private inFlight = 0;
  private started = false;

  constructor(options: Partial<SchedulerOptions> & { workerId?: string } = {}) {
    super();
    this.options = {
      ...DEFAULT_OPTIONS,
      workerId: options.workerId ?? `worker-${process.pid}`,
      ...options,
    } as SchedulerOptions;

    this.queue = new MemoryQueue(this.options.now);
    this.worker = new Worker(this.options.workerId, {
      queue: this.queue,
      runs: this.runs,
      metrics: this.metrics,
      now: this.options.now,
      visibilityTimeoutMs: this.options.visibilityTimeoutMs,
    });

    this.worker.on("log", (e) => this.emit("log", e));
    this.worker.on("success", (e) => this.emit("success", e));
    this.worker.on("failure", (e) => this.emit("failure", e));
  }

  /** Define a job and schedule its first run. */
  define(input: CreateJobInput): JobDefinition {
    const job = this.jobs.create(input);
    if (job.enabled) {
      this.scheduleNext(job);
    }
    return job;
  }

  /** Enqueue a run immediately, outside the trigger schedule. */
  trigger(jobIdOrName: string, at?: number): JobRun {
    const job = this.jobs.get(jobIdOrName) ?? this.jobs.getByName(jobIdOrName);
    if (!job) throw new Error(`no job "${jobIdOrName}"`);

    const run = this.runs.create(job, at ?? this.options.now());
    this.queue.enqueue(run);
    this.emit("scheduled", { job, run });
    return run;
  }

  /** Turn a job off and drop anything queued for it. */
  disable(jobId: string): void {
    this.jobs.update(jobId, { enabled: false });
    this.queue.purgeJob(jobId);
  }

  enable(jobId: string): void {
    const job = this.jobs.update(jobId, { enabled: true });
    this.scheduleNext(job);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.timer = setInterval(() => this.tick(), this.options.pollIntervalMs);
    this.emit("started", { workerId: this.options.workerId });
  }

  async stop(): Promise<void> {
    this.started = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    while (this.inFlight > 0) {
      await new Promise((r) => setTimeout(r, 10));
    }
    this.emit("stopped", {});
  }

  /** One scheduling pass. Exposed so tests can drive it deterministically. */
  async tick(): Promise<void> {
    while (this.inFlight < this.options.concurrency) {
      const run = this.queue.claim(this.options.workerId, this.options.visibilityTimeoutMs);
      if (!run) return;

      const job = this.jobs.get(run.jobId);
      if (!job || !job.enabled) {
        this.queue.release(run.id);
        continue;
      }

      if (job.singleton && this.runs.hasActiveRun(job.id, run.id)) {
        this.metrics.increment("runs.skipped");
        this.queue.release(run.id);
        continue;
      }

      this.inFlight++;
      this.dispatch(run, job);
    }
  }

  private dispatch(run: JobRun, job: JobDefinition): void {
    const handler = this.registry.get(job.handler);

    if (!handler) {
      this.runs.update(run.id, {
        state: "dead",
        error: `no handler registered for "${job.handler}"`,
        finishedAt: this.options.now(),
      });
      this.queue.release(run.id);
      this.inFlight--;
      return;
    }

    this.worker
      .execute(run, job, handler)
      .then((outcome) => {
        this.queue.release(run.id);
        if (outcome.ok) {
          this.scheduleNext(job);
        } else {
          this.handleFailure(run, job);
        }
      })
      .finally(() => {
        this.inFlight--;
      });
  }

  private handleFailure(run: JobRun, job: JobDefinition): void {
    if (!shouldRetry(job.retry, run.attempt)) {
      this.runs.update(run.id, { state: "dead" });
      this.metrics.increment("runs.dead");
      this.emit("dead", { run, job });
      this.scheduleNext(job);
      return;
    }

    const delay = backoffMs(job.retry, run.attempt);
    const retry = this.runs.create(job, this.options.now() + delay, run.attempt + 1);
    this.queue.enqueue(retry);
    this.metrics.increment("runs.retried");
    this.emit("retry", { run: retry, job, delay });
  }

  /** Queue the next run implied by the job's trigger. */
  private scheduleNext(job: JobDefinition): void {
    const now = this.options.now();
    let at: number;

    switch (job.trigger.kind) {
      case "once":
        if (this.runs.latest(job.id)) return;
        at = job.trigger.at!;
        break;
      case "interval":
        at = now + job.trigger.everyMs!;
        break;
      case "cron":
        at = nextRun(job.trigger.expression!, now, job.trigger.timezone);
        break;
      default:
        return;
    }

    const run = this.runs.create(job, at);
    this.queue.enqueue(run);
    this.emit("scheduled", { job, run });
  }

  stats(): SchedulerStats {
    return {
      running: this.started,
      inFlight: this.inFlight,
      jobs: this.jobs.size,
      queue: this.queue.stats(),
      metrics: this.metrics.snapshot(),
    };
  }
}
