import { readFileSync, writeFileSync, existsSync } from "node:fs";
import type { JobDefinition, JobRun } from "../types";
import type { JobStore } from "./jobs";
import type { RunStore } from "./runs";

export interface Snapshot {
  version: number;
  savedAt: number;
  jobs: JobDefinition[];
  runs: JobRun[];
}

const VERSION = 1;

/**
 * Dump definitions and recent runs to disk so a restart does not lose the
 * schedule. Written on a timer and on shutdown.
 */
export function save(path: string, jobs: JobStore, runs: RunStore): void {
  const snapshot: Snapshot = {
    version: VERSION,
    savedAt: Date.now(),
    jobs: jobs.list(),
    runs: runs.list({ limit: 1000 }),
  };
  writeFileSync(path, JSON.stringify(snapshot));
}

/** Read a snapshot back. Returns null when there is nothing to restore. */
export function load(path: string): Snapshot | null {
  if (!existsSync(path)) return null;

  const parsed = JSON.parse(readFileSync(path, "utf8")) as Snapshot;
  if (parsed.version !== VERSION) {
    throw new Error(`snapshot version ${parsed.version} is not supported`);
  }
  return parsed;
}

/**
 * Restore definitions into a fresh store. Runs that were in flight when the
 * process died are reset to pending so they get picked up again.
 */
export function restore(snapshot: Snapshot, jobs: JobStore): JobDefinition[] {
  const restored: JobDefinition[] = [];

  for (const job of snapshot.jobs) {
    jobs.create({
      name: job.name,
      handler: job.handler,
      payload: job.payload,
      trigger: job.trigger,
      retry: job.retry,
      priority: job.priority,
      timeoutMs: job.timeoutMs,
      singleton: job.singleton,
      enabled: job.enabled,
    });
    restored.push(job);
  }

  return restored;
}

/** Runs that should be requeued after a crash. */
export function orphanedRuns(snapshot: Snapshot): JobRun[] {
  return snapshot.runs.filter((run) => run.state === "claimed" || run.state === "running");
}
