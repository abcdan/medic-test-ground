import { randomUUID } from "node:crypto";
import { DEFAULT_RETRY, type JobDefinition, type RetryPolicy, type Trigger } from "../types";
import { isValidCron } from "../cron/parse";

export interface CreateJobInput {
  name: string;
  handler: string;
  trigger: Trigger;
  payload?: Record<string, unknown>;
  retry?: Partial<RetryPolicy>;
  priority?: number;
  timeoutMs?: number;
  singleton?: boolean;
  enabled?: boolean;
}

/** In-memory job definition table. */
export class JobStore {
  private jobs = new Map<string, JobDefinition>();
  private byName = new Map<string, string>();

  create(input: CreateJobInput): JobDefinition {
    if (this.byName.has(input.name)) {
      throw new Error(`a job named "${input.name}" already exists`);
    }
    validateTrigger(input.trigger);

    const now = Date.now();
    const job: JobDefinition = {
      id: randomUUID(),
      name: input.name,
      handler: input.handler,
      payload: input.payload ?? {},
      trigger: input.trigger,
      retry: { ...DEFAULT_RETRY, ...input.retry },
      priority: input.priority ?? 0,
      timeoutMs: input.timeoutMs ?? 60_000,
      singleton: input.singleton ?? true,
      enabled: input.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    };

    this.jobs.set(job.id, job);
    this.byName.set(job.name, job.id);
    return job;
  }

  get(id: string): JobDefinition | undefined {
    return this.jobs.get(id);
  }

  getByName(name: string): JobDefinition | undefined {
    const id = this.byName.get(name);
    return id ? this.jobs.get(id) : undefined;
  }

  update(id: string, patch: Partial<JobDefinition>): JobDefinition {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`no job ${id}`);
    if (patch.trigger) validateTrigger(patch.trigger);
    Object.assign(job, patch, { updatedAt: Date.now() });
    return job;
  }

  remove(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;
    this.jobs.delete(id);
    this.byName.delete(job.name);
    return true;
  }

  list(filter: { enabled?: boolean; handler?: string } = {}): JobDefinition[] {
    return [...this.jobs.values()].filter((job) => {
      if (filter.enabled !== undefined && job.enabled !== filter.enabled) return false;
      if (filter.handler && job.handler !== filter.handler) return false;
      return true;
    });
  }

  get size(): number {
    return this.jobs.size;
  }
}

export function validateTrigger(trigger: Trigger): void {
  switch (trigger.kind) {
    case "cron":
      if (!trigger.expression) throw new Error("cron trigger needs an expression");
      if (!isValidCron(trigger.expression)) throw new Error(`bad cron expression "${trigger.expression}"`);
      return;
    case "interval":
      if (!trigger.everyMs || trigger.everyMs <= 0) throw new Error("interval trigger needs a positive everyMs");
      return;
    case "once":
      if (trigger.at === undefined) throw new Error("once trigger needs an at timestamp");
      return;
    default:
      throw new Error(`unknown trigger kind "${(trigger as Trigger).kind}"`);
  }
}
