/** Core domain types shared across the scheduler. */

export type JobState =
  | "pending"
  | "claimed"
  | "running"
  | "succeeded"
  | "failed"
  | "dead"
  | "cancelled";

export type TriggerKind = "once" | "cron" | "interval";

export interface RetryPolicy {
  /** How many times to retry after the first attempt fails. */
  maxAttempts: number;
  /** First backoff delay in milliseconds. */
  baseDelayMs: number;
  /** Never wait longer than this between attempts. */
  maxDelayMs: number;
  /** Multiply the delay by this each attempt. */
  factor: number;
  /** Randomise the delay by up to this fraction, to spread retries out. */
  jitter: number;
}

export const DEFAULT_RETRY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 5 * 60 * 1000,
  factor: 2,
  jitter: 0.2,
};

export interface Trigger {
  kind: TriggerKind;
  /** Cron expression, for kind "cron". */
  expression?: string;
  /** Milliseconds between runs, for kind "interval". */
  everyMs?: number;
  /** Epoch millis, for kind "once". */
  at?: number;
  /** IANA timezone the cron expression is interpreted in. */
  timezone?: string;
}

export interface JobDefinition {
  id: string;
  name: string;
  /** Handler key looked up in the registry. */
  handler: string;
  payload: Record<string, unknown>;
  trigger: Trigger;
  retry: RetryPolicy;
  /** Jobs with a higher priority are claimed first. */
  priority: number;
  /** Kill a run that exceeds this many milliseconds. */
  timeoutMs: number;
  /** Skip a run if the previous one is still going. */
  singleton: boolean;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface JobRun {
  id: string;
  jobId: string;
  attempt: number;
  state: JobState;
  /** When this run became eligible to be claimed. */
  scheduledFor: number;
  claimedAt: number | null;
  claimedBy: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  /** When the claim lapses and another worker may take over. */
  visibleAt: number | null;
  output: unknown;
  error: string | null;
}

export interface JobContext {
  run: JobRun;
  job: JobDefinition;
  /** Resolves when the run has been asked to stop. */
  signal: AbortSignal;
  log: (message: string, extra?: Record<string, unknown>) => void;
  /** Push the visibility deadline out for a long running job. */
  heartbeat: () => void;
}

export type Handler = (payload: Record<string, unknown>, ctx: JobContext) => Promise<unknown>;

export interface SchedulerOptions {
  /** Identifier for this process, used to stamp claims. */
  workerId: string;
  /** How many runs this process executes at once. */
  concurrency: number;
  /** How often to look for due work. */
  pollIntervalMs: number;
  /** How long a claim is held before another worker may steal it. */
  visibilityTimeoutMs: number;
  /** Stop claiming new work after this instant. Used by tests. */
  now: () => number;
}

export const DEFAULT_OPTIONS: Omit<SchedulerOptions, "workerId"> = {
  concurrency: 4,
  pollIntervalMs: 250,
  visibilityTimeoutMs: 30_000,
  now: () => Date.now(),
};
