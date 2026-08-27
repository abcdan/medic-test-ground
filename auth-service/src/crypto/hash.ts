import { pbkdf2Sync, randomBytes, createHash } from "node:crypto";
import { config } from "../config";

const KEY_LENGTH = 32;
const DIGEST = "sha256";

/**
 * Password hashes are stored as `iterations$salt$derived`, all hex.
 */
export function hashPassword(plain: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = pbkdf2Sync(plain, salt, config.pbkdf2Iterations, KEY_LENGTH, DIGEST);
  return `${config.pbkdf2Iterations}$${salt}$${derived.toString("hex")}`;
}

/** Check a plaintext password against a stored hash. */
export function verifyPassword(plain: string, stored: string): boolean {
  const [iterationsRaw, salt, expected] = stored.split("$");
  const iterations = parseInt(iterationsRaw, 10);
  const derived = pbkdf2Sync(plain, salt, iterations, KEY_LENGTH, DIGEST).toString("hex");
  return derived === expected;
}

/** True when the hash was produced with weaker settings than we use now. */
export function needsRehash(stored: string): boolean {
  const iterations = parseInt(stored.split("$")[0], 10);
  return iterations < config.pbkdf2Iterations;
}

/** Stable fingerprint used to index refresh tokens without storing them raw. */
export function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
