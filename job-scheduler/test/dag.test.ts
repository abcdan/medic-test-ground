import test from "node:test";
import assert from "node:assert";
import { DependencyGraph } from "../src/dag";
import { Calendar, BUSINESS_HOURS } from "../src/calendar";

test("orders upstreams first", () => {
  const g = new DependencyGraph();
  g.add("extract", "transform");
  g.add("transform", "load");
  assert.deepEqual(g.order(["load", "extract", "transform"]), ["extract", "transform", "load"]);
});

test("rejects self dependency", () => {
  const g = new DependencyGraph();
  assert.throws(() => g.add("a", "a"));
});

test("reports readiness", () => {
  const g = new DependencyGraph();
  g.add("a", "c");
  g.add("b", "c");
  assert.ok(!g.isReady("c", new Set(["a"])));
  assert.ok(g.isReady("c", new Set(["a", "b"])));
});

test("blackouts close the window", () => {
  const cal = new Calendar();
  const wednesdayNoon = new Date("2026-01-07T12:00:00").getTime();
  assert.ok(cal.isOpen(wednesdayNoon, BUSINESS_HOURS));

  cal.addBlackout({ name: "freeze", from: wednesdayNoon - 1000, to: wednesdayNoon + 1000 });
  assert.ok(!cal.isOpen(wednesdayNoon, BUSINESS_HOURS));
});

test("nextOpen walks forward", () => {
  const cal = new Calendar();
  const saturday = new Date("2026-01-10T12:00:00").getTime();
  const next = cal.nextOpen(saturday, BUSINESS_HOURS);
  assert.equal(new Date(next).getDay(), 1);
});
