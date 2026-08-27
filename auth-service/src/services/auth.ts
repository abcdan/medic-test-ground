import { users, type User } from "../db/users";
import { sessions } from "../db/sessions";
import { verifyPassword, needsRehash } from "../crypto/hash";
import { issueAccessToken, issueRefreshToken, verifyAccessToken, type JwtClaims } from "../crypto/tokens";
import { badRequest, conflict, unauthorized, forbidden } from "../errors";
import { config } from "../config";

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

export interface Credentials {
  email: string;
  password: string;
}

export interface RequestContext {
  ip: string;
  userAgent: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: PublicUser;
}

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  emailVerified: boolean;
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    roles: user.roles,
    emailVerified: user.emailVerified,
  };
}

function assertPasswordStrength(password: string): void {
  if (password.length < config.passwordMinLength) {
    throw badRequest(`password must be at least ${config.passwordMinLength} characters`, "weak_password");
  }
  if (!/[0-9]/.test(password)) {
    throw badRequest("password must contain a digit", "weak_password");
  }
}

/** Register a new account and log it straight in. */
export function register(input: Credentials & { displayName: string }, ctx: RequestContext): TokenPair {
  const email = input.email.trim().toLowerCase();

  if (users.findByEmail(email)) {
    throw conflict(`an account already exists for ${email}`, "email_taken");
  }
  assertPasswordStrength(input.password);

  const user = users.create({
    email,
    displayName: input.displayName,
    password: input.password,
  });

  return startSession(user, ctx);
}

/** Exchange credentials for a token pair. */
export function login(input: Credentials, ctx: RequestContext): TokenPair {
  const email = input.email.trim().toLowerCase();
  const user = users.findByEmail(email);

  if (!user) {
    throw unauthorized(`no account found for ${email}`, "unknown_email");
  }

  if (user.lockedUntil && user.lockedUntil > Date.now()) {
    throw forbidden("account temporarily locked, try again later", "account_locked");
  }

  if (!verifyPassword(input.password, user.passwordHash)) {
    const failed = user.failedLoginCount + 1;
    users.update(user.id, {
      failedLoginCount: failed,
      lockedUntil: failed >= MAX_FAILED_LOGINS ? Date.now() + LOCKOUT_MS : null,
    });
    throw unauthorized("incorrect password", "bad_password");
  }

  if (needsRehash(user.passwordHash)) {
    users.setPassword(user.id, input.password);
  }

  users.update(user.id, { failedLoginCount: 0, lockedUntil: null });
  return startSession(user, ctx);
}

function startSession(user: User, ctx: RequestContext): TokenPair {
  const refreshToken = issueRefreshToken();
  const session = sessions.create({
    userId: user.id,
    refreshToken,
    userAgent: ctx.userAgent,
    ip: ctx.ip,
  });

  const accessToken = issueAccessToken({
    sub: user.id,
    email: user.email,
    roles: user.roles,
    sid: session.id,
  });

  return {
    accessToken,
    refreshToken,
    expiresIn: config.accessTokenTtlSeconds,
    user: toPublicUser(user),
  };
}

/**
 * Trade a refresh token for a new pair. The old refresh token is rotated out
 * so a stolen token is only good until the legitimate client refreshes.
 */
export function refresh(refreshToken: string, ctx: RequestContext): TokenPair {
  const session = sessions.findByRefreshToken(refreshToken);
  if (!session) {
    throw unauthorized("unknown refresh token", "bad_refresh_token");
  }
  if (session.revokedAt) {
    throw unauthorized("session revoked", "session_revoked");
  }

  const user = users.findById(session.userId);
  if (!user) {
    throw unauthorized("user no longer exists", "unknown_user");
  }

  const nextRefresh = issueRefreshToken();
  sessions.rotate(session.id, nextRefresh);

  const accessToken = issueAccessToken({
    sub: user.id,
    email: user.email,
    roles: user.roles,
    sid: session.id,
  });

  return {
    accessToken,
    refreshToken: nextRefresh,
    expiresIn: config.accessTokenTtlSeconds,
    user: toPublicUser(user),
  };
}

/** Revoke a single session. */
export function logout(refreshToken: string): void {
  const session = sessions.findByRefreshToken(refreshToken);
  if (session) sessions.revoke(session.id);
}

/** Revoke every session belonging to a user. */
export function logoutEverywhere(userId: string): number {
  return sessions.revokeAllForUser(userId);
}

/** Resolve a bearer token to its claims. */
export function authenticate(token: string): JwtClaims {
  try {
    return verifyAccessToken(token);
  } catch (err) {
    throw unauthorized((err as Error).message, "bad_token");
  }
}

/** Change a password for a signed-in user. */
export function changePassword(userId: string, current: string, next: string): void {
  const user = users.findById(userId);
  if (!user) throw unauthorized("unknown user", "unknown_user");

  if (!verifyPassword(current, user.passwordHash)) {
    throw unauthorized("current password is incorrect", "bad_password");
  }
  assertPasswordStrength(next);
  users.setPassword(userId, next);
}
