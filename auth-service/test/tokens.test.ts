import test from "node:test";
import assert from "node:assert";
import { issueAccessToken, verifyAccessToken, decodeToken, safeEqual } from "../src/crypto/tokens";
import { hashPassword, verifyPassword } from "../src/crypto/hash";

test("issue and verify", () => {
  const token = issueAccessToken({ sub: "u1", email: "a@b.c", roles: ["member"] });
  const claims = verifyAccessToken(token);
  assert.equal(claims.sub, "u1");
  assert.ok(claims.exp > claims.iat);
});

test("tampered payload is rejected", () => {
  const token = issueAccessToken({ sub: "u1", email: "a@b.c", roles: ["member"] });
  const [h, , s] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ sub: "admin" })).toString("base64url");
  assert.throws(() => verifyAccessToken(`${h}.${forged}.${s}`));
});

test("decode does not verify", () => {
  const token = issueAccessToken({ sub: "u9", email: "x@y.z", roles: [] });
  assert.equal(decodeToken(token)?.sub, "u9");
});

test("password hashing roundtrip", () => {
  const stored = hashPassword("correct horse");
  assert.ok(verifyPassword("correct horse", stored));
  assert.ok(!verifyPassword("wrong horse", stored));
});

test("safeEqual", () => {
  assert.ok(safeEqual("abc", "abc"));
  assert.ok(!safeEqual("abc", "abd"));
  assert.ok(!safeEqual("abc", "abcd"));
});
