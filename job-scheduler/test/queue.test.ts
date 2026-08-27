import test from "node:test";
import assert from "node:assert";
import { PriorityQueue } from "../src/queue/priority";
import { MemoryQueue } from "../src/queue/memory-queue";
import type { JobRun } from "../src/types";

function makeRun(id: string, scheduledFor: number): JobRun {
  return {
    id,
    jobId: "job",
    attempt: 1,
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
}

test("priority queue pops in order", () => {
  const pq = new PriorityQueue<number>((a, b) => a - b);
  for (const n of [5, 3, 9, 1, 7]) pq.push(n);
  const out: number[] = [];
  while (pq.size) out.push(pq.pop()!);
  assert.deepEqual(out, [1, 3, 5, 7, 9]);
});

test("priority queue removes by predicate", () => {
  const pq = new PriorityQueue<number>((a, b) => a - b);
  for (const n of [4, 2, 6]) pq.push(n);
  assert.equal(pq.remove((n) => n === 4), 4);
  assert.equal(pq.size, 2);
});

test("queue only hands out due runs", () => {
  let clock = 1000;
  const q = new MemoryQueue(() => clock);
  q.enqueue(makeRun("a", 2000));
  assert.equal(q.claim("w1", 5000), undefined);
  clock = 2500;
  assert.equal(q.claim("w1", 5000)?.id, "a");
});

test("expired claims come back", () => {
  let clock = 0;
  const q = new MemoryQueue(() => clock);
  q.enqueue(makeRun("a", 0));
  const claimed = q.claim("w1", 100);
  assert.ok(claimed);
  clock = 50;
  assert.equal(q.recoverExpiredClaims(), 0);
  clock = 200;
  assert.equal(q.recoverExpiredClaims(), 1);
  assert.equal(q.claim("w2", 100)?.id, "a");
});

test("purgeJob drops queued runs", () => {
  const q = new MemoryQueue(() => 0);
  q.enqueue(makeRun("a", 0));
  q.enqueue(makeRun("b", 0));
  assert.equal(q.purgeJob("job"), 2);
  assert.equal(q.stats().pending, 0);
});
