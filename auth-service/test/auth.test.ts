import test from "node:test";
import assert from "node:assert";
import * as auth from "../src/services/auth";
import { users } from "../src/db/users";
import { HttpError } from "../src/errors";

const ctx = { ip: "127.0.0.1", userAgent: "node-test" };

function unique(prefix: string): string {
  return `${prefix}-${users.count()}@example.com`;
}

test("register then login", () => {
  const email = unique("alice");
  const created = auth.register({ email, password: "hunter2000", displayName: "Alice" }, ctx);
  assert.equal(created.user.email, email);
  assert.ok(created.accessToken.split(".").length === 3);

  const loggedIn = auth.login({ email, password: "hunter2000" }, ctx);
  assert.equal(loggedIn.user.id, created.user.id);
});

test("rejects a weak password", () => {
  assert.throws(
    () => auth.register({ email: unique("weak"), password: "short", displayName: "W" }, ctx),
    (e: unknown) => e instanceof HttpError && e.status === 400,
  );
});

test("rejects a duplicate email", () => {
  const email = unique("dup");
  auth.register({ email, password: "password1", displayName: "D" }, ctx);
  assert.throws(
    () => auth.register({ email, password: "password1", displayName: "D" }, ctx),
    (e: unknown) => e instanceof HttpError && e.status === 409,
  );
});

test("rejects a bad password", () => {
  const email = unique("bad");
  auth.register({ email, password: "password1", displayName: "B" }, ctx);
  assert.throws(
    () => auth.login({ email, password: "wrongpassword" }, ctx),
    (e: unknown) => e instanceof HttpError && e.status === 401,
  );
});

test("refresh rotates the refresh token", () => {
  const email = unique("rot");
  const first = auth.register({ email, password: "password1", displayName: "R" }, ctx);
  const second = auth.refresh(first.refreshToken, ctx);
  assert.notEqual(first.refreshToken, second.refreshToken);
  assert.equal(second.user.id, first.user.id);
});

test("logout revokes the session", () => {
  const email = unique("out");
  const pair = auth.register({ email, password: "password1", displayName: "O" }, ctx);
  auth.logout(pair.refreshToken);
  assert.throws(() => auth.refresh(pair.refreshToken, ctx));
});
