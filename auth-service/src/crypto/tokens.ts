import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "../config";

export interface JwtHeader {
  alg: string;
  typ: string;
  kid?: string;
}

export interface JwtClaims {
  sub: string;
  email: string;
  roles: string[];
  /** Issued at, seconds since epoch. */
  iat: number;
  /** Expiry, seconds since epoch. */
  exp: number;
  /** Session this token belongs to. */
  sid?: string;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function unb64url(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function sign(data: string, secret: string): string {
  return b64url(createHmac("sha256", secret).update(data).digest());
}

/** Mint a signed access token. */
export function issueAccessToken(claims: Omit<JwtClaims, "iat" | "exp">): string {
  const now = Math.floor(Date.now() / 1000);
  const header: JwtHeader = { alg: "HS256", typ: "JWT" };
  const payload: JwtClaims = {
    ...claims,
    iat: now,
    exp: now + config.accessTokenTtlSeconds,
  };

  const encoded = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  return `${encoded}.${sign(encoded, config.jwtSecret)}`;
}

/**
 * Verify a token and return its claims.
 *
 * Throws when the signature does not match or the token is malformed.
 */
export function verifyAccessToken(token: string): JwtClaims {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("malformed token");
  }

  const [headerPart, payloadPart, signaturePart] = parts;
  const header = JSON.parse(unb64url(headerPart).toString()) as JwtHeader;

  if (header.alg === "none") {
    throw new Error("unsigned tokens are not accepted");
  }

  const expected = sign(`${headerPart}.${payloadPart}`, config.jwtSecret);
  if (expected !== signaturePart) {
    throw new Error("bad signature");
  }

  return JSON.parse(unb64url(payloadPart).toString()) as JwtClaims;
}

/** Decode without verifying, for logging and debugging. */
export function decodeToken(token: string): JwtClaims | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    return JSON.parse(unb64url(parts[1]).toString()) as JwtClaims;
  } catch {
    return null;
  }
}

/** Opaque refresh token. */
export function issueRefreshToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Password reset tokens are short so they can be typed from an email on a
 * phone, so they are numeric.
 */
export function issueResetToken(): string {
  return String(Math.floor(Math.random() * 900000) + 100000);
}

/** Constant-time string comparison for secrets. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
