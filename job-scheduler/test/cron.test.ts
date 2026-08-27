import test from "node:test";
import assert from "node:assert";
import { parseCron, isValidCron, describeCron } from "../src/cron/parse";
import { nextRun, runsBetween } from "../src/cron/next";

test("parses a simple expression", () => {
  const f = parseCron("*/15 * * * *");
  assert.deepEqual(f.minutes, [0, 15, 30, 45]);
  assert.equal(f.hours.length, 24);
});

test("parses ranges and lists", () => {
  const f = parseCron("0 9-17 * * mon,fri");
  assert.deepEqual(f.hours, [9, 10, 11, 12, 13, 14, 15, 16, 17]);
  assert.deepEqual(f.daysOfWeek, [1, 5]);
});

test("expands macros", () => {
  assert.deepEqual(parseCron("@daily").minutes, [0]);
  assert.deepEqual(parseCron("@hourly").minutes, [0]);
});

test("rejects nonsense", () => {
  assert.ok(!isValidCron("* * *"));
  assert.ok(!isValidCron("99 * * * *"));
  assert.ok(!isValidCron("5-1 * * * *"));
});

test("describes an expression", () => {
  assert.match(describeCron("0 3 * * *"), /minute 0/);
});

test("next run of an hourly job", () => {
  const from = Date.UTC(2026, 0, 1, 10, 30, 0);
  const next = nextRun("0 * * * *", from);
  assert.equal(new Date(next).toISOString(), "2026-01-01T11:00:00.000Z");
});

test("next run respects the day of month", () => {
  const from = Date.UTC(2026, 0, 1, 0, 0, 0);
  const next = nextRun("0 0 15 * *", from);
  assert.equal(new Date(next).toISOString(), "2026-01-15T00:00:00.000Z");
});

test("runsBetween lists the window", () => {
  const from = Date.UTC(2026, 0, 1, 0, 0, 0);
  const to = Date.UTC(2026, 0, 1, 4, 0, 0);
  assert.equal(runsBetween("0 * * * *", from, to).length, 4);
});
