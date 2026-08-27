# job-scheduler

Cron and interval job scheduling for a single Node process, with retries,
timeouts, visibility timeouts and a small admin API.

```ts
import { Scheduler } from "./src";

const scheduler = new Scheduler({ workerId: "api-1", concurrency: 8 });

scheduler.registry.register("send-digest", async (payload, ctx) => {
  ctx.log("building digest", { tenant: payload.tenant });
  ctx.heartbeat();
  return await buildAndSend(payload.tenant as string);
});

scheduler.define({
  name: "nightly-digest",
  handler: "send-digest",
  payload: { tenant: "acme" },
  trigger: { kind: "cron", expression: "0 3 * * *", timezone: "Europe/Amsterdam" },
  retry: { maxAttempts: 5, baseDelayMs: 2000 },
  timeoutMs: 120_000,
});

scheduler.start();
```

## Triggers

| Kind | Field | Behaviour |
| --- | --- | --- |
| `once` | `at` | Runs a single time at an epoch millisecond |
| `interval` | `everyMs` | Reschedules itself after each run |
| `cron` | `expression`, `timezone` | Five field cron, macros supported |

## Lifecycle

```
pending ──claim──> claimed ──start──> running ──┬──> succeeded ──> (reschedule)
   ▲                  │                         └──> failed ──┬──> pending (retry)
   └──visibility──────┘                                       └──> dead
      timeout lapses
```

A claim is held for `visibilityTimeoutMs`. A long running job calls
`ctx.heartbeat()` to push the deadline out; if a worker dies, the claim
lapses and the run is picked up again.

## Retries

Exponential backoff with jitter, clamped to `maxDelayMs`:

```ts
{ maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 300_000, factor: 2, jitter: 0.2 }
```

Runs that exhaust their attempts land in `dead` and emit a `dead` event.

## Cron support

`*`, ranges, lists, steps, three letter month/weekday names, and the
`@hourly` / `@daily` / `@weekly` / `@monthly` / `@yearly` macros. Expressions
are evaluated in the job's `timezone`, defaulting to UTC.

## Admin API

```
GET    /stats           scheduler + queue + metrics snapshot
GET    /metrics         counters and duration histograms
GET    /jobs            all definitions
POST   /jobs            define a job
GET    /jobs/{id}       definition plus recent runs
POST   /trigger/{id}    enqueue a run right now
DELETE /jobs/{id}       disable and purge queued runs
```

## Layout

```
src/cron/       expression parser and next-run search
src/queue/      binary heap + the claim/visibility queue
src/store/      job definitions and run history
src/worker.ts   executes one run, enforces the timeout
src/scheduler.ts  polling loop, dispatch, retry and reschedule
src/metrics.ts  counters and timings
src/api.ts      admin HTTP surface
```
