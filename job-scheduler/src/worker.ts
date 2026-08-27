import { EventEmitter } from "node:events";
import type { Handler, JobContext, JobDefinition, JobRun } from "./types";
import type { MemoryQueue } from "./queue/memory-queue";
import type { RunStore } from "./store/runs";
import type { Metrics } from "./metrics";

export interface WorkerDeps {
  queue: MemoryQueue;
  runs: RunStore;
  metrics: Metrics;
  now: () => number;
  visibilityTimeoutMs: number;
}

export interface RunOutcome {
  run: JobRun;
  ok: boolean;
  output?: unknown;
  error?: Error;
  durationMs: number;
}

/**
 * Executes a single run: sets up the context, enforces the timeout, and
 * records the outcome. Retry scheduling is the scheduler's job.
 */
export class Worker extends EventEmitter {
  constructor(
    private readonly workerId: string,
    private readonly deps: WorkerDeps,
  ) {
    super();
  }

  async execute(run: JobRun, job: JobDefinition, handler: Handler): Promise<RunOutcome> {
    const started = this.deps.now();
    const controller = new AbortController();

    this.deps.runs.update(run.id, { state: "running", startedAt: started });
    this.emit("start", { run, job });
    this.deps.metrics.increment("runs.started");

    const ctx: JobContext = {
      run,
      job,
      signal: controller.signal,
      log: (message, extra) => this.emit("log", { run, job, message, extra }),
      heartbeat: () => this.deps.queue.heartbeat(run.id, this.deps.visibilityTimeoutMs),
    };

    const timer = setTimeout(() => controller.abort(), job.timeoutMs);

    try {
      const output = await Promise.race([
        handler(job.payload, ctx),
        timeoutPromise(job.timeoutMs, job.name),
      ]);

      const durationMs = this.deps.now() - started;
      this.deps.runs.update(run.id, {
        state: "succeeded",
        finishedAt: this.deps.now(),
        output,
      });
      this.deps.metrics.increment("runs.succeeded");
      this.deps.metrics.observe(`job.${job.name}.duration`, durationMs);
      this.emit("success", { run, job, output, durationMs });

      return { run, ok: true, output, durationMs };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const durationMs = this.deps.now() - started;

      this.deps.runs.update(run.id, {
        state: "failed",
        finishedAt: this.deps.now(),
        error: error.message,
      });
      this.deps.metrics.increment("runs.failed");
      this.emit("failure", { run, job, error, durationMs });

      return { run, ok: false, error, durationMs };
    } finally {
      clearTimeout(timer);
    }
  }

  get id(): string {
    return this.workerId;
  }
}

function timeoutPromise(ms: number, jobName: string): Promise<never> {
  return new Promise((_resolve, reject) => {
    setTimeout(() => reject(new Error(`job "${jobName}" exceeded its ${ms}ms timeout`)), ms);
  });
}
