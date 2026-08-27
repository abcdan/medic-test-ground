import test from "node:test";
import assert from "node:assert";
import { Scheduler } from "../src/scheduler";
import { backoffMs, shouldRetry, worstCaseTotalMs } from "../src/backoff";
import { DEFAULT_RETRY } from "../src/types";

test("backoff grows and clamps", () => {
  const fixed = () => 0.5;
  const policy = { ...DEFAULT_RETRY, jitter: 0 };
  assert.equal(backoffMs(policy, 1, fixed), 1000);
  assert.equal(backoffMs(policy, 2, fixed), 2000);
  assert.equal(backoffMs(policy, 3, fixed), 4000);
  assert.equal(backoffMs(policy, 30, fixed), policy.maxDelayMs);
});

test("shouldRetry respects maxAttempts", () => {
  assert.ok(shouldRetry(DEFAULT_RETRY, 1));
  assert.ok(!shouldRetry(DEFAULT_RETRY, 3));
});

test("worst case is finite", () => {
  assert.ok(worstCaseTotalMs(DEFAULT_RETRY) > 0);
});

test("defines a job and schedules a run", () => {
  let clock = Date.UTC(2026, 0, 1, 0, 0, 0);
  const s = new Scheduler({ now: () => clock, workerId: "test" });
  s.registry.register("noop", async () => "done");

  const job = s.define({ name: "hourly", handler: "noop", trigger: { kind: "cron", expression: "0 * * * *" } });
  assert.equal(job.name, "hourly");
  assert.equal(s.stats().queue.pending, 1);
});

test("runs a due job", async () => {
  let clock = 1000;
  const s = new Scheduler({ now: () => clock, workerId: "test", concurrency: 1 });

  let ran = 0;
  s.registry.register("count", async () => {
    ran++;
    return ran;
  });

  s.define({ name: "every-second", handler: "count", trigger: { kind: "interval", everyMs: 1000 }, timeoutMs: 500 });
  clock = 2500;
  await s.tick();
  await new Promise((r) => setTimeout(r, 20));

  assert.equal(ran, 1);
  assert.equal(s.metrics.snapshot().counters["runs.succeeded"], 1);
});

test("a failing job is retried", async () => {
  let clock = 1000;
  const s = new Scheduler({ now: () => clock, workerId: "test", concurrency: 1 });

  s.registry.register("boom", async () => {
    throw new Error("nope");
  });

  s.define({
    name: "flaky",
    handler: "boom",
    trigger: { kind: "interval", everyMs: 1000 },
    timeoutMs: 500,
    retry: { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 5, factor: 2, jitter: 0 },
  });

  clock = 2500;
  await s.tick();
  await new Promise((r) => setTimeout(r, 30));

  assert.equal(s.metrics.snapshot().counters["runs.failed"], 1);
  assert.equal(s.metrics.snapshot().counters["runs.retried"], 1);
});
