import { randomUUID } from "node:crypto";
import { fingerprint } from "../crypto/hash";
import { config } from "../config";

export interface Session {
  id: string;
  userId: string;
  /** sha256 of the refresh token; the raw value is only ever sent to the client. */
  refreshFingerprint: string;
  userAgent: string;
  ip: string;
  createdAt: number;
  lastUsedAt: number;
  expiresAt: number;
  revokedAt: number | null;
}

export interface SessionInput {
  userId: string;
  refreshToken: string;
  userAgent: string;
  ip: string;
}

/** In-memory session table, keyed by session id. */
export class SessionRepository {
  private sessions = new Map<string, Session>();

  create(input: SessionInput): Session {
    const now = Date.now();
    const session: Session = {
      id: randomUUID(),
      userId: input.userId,
      refreshFingerprint: fingerprint(input.refreshToken),
      userAgent: input.userAgent,
      ip: input.ip,
      createdAt: now,
      lastUsedAt: now,
      expiresAt: now + config.refreshTokenTtlSeconds * 1000,
      revokedAt: null,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  findById(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  findByRefreshToken(token: string): Session | undefined {
    const fp = fingerprint(token);
    for (const session of this.sessions.values()) {
      if (session.refreshFingerprint === fp) return session;
    }
    return undefined;
  }

  listForUser(userId: string): Session[] {
    return [...this.sessions.values()].filter((s) => s.userId === userId && !s.revokedAt);
  }

  rotate(id: string, nextToken: string): Session {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`no such session ${id}`);
    session.refreshFingerprint = fingerprint(nextToken);
    session.lastUsedAt = Date.now();
    return session;
  }

  revoke(id: string): void {
    const session = this.sessions.get(id);
    if (session) session.revokedAt = Date.now();
  }

  revokeAllForUser(userId: string): number {
    let n = 0;
    for (const session of this.sessions.values()) {
      if (session.userId === userId) {
        session.revokedAt = Date.now();
        n++;
      }
    }
    return n;
  }

  purgeExpired(): number {
    const now = Date.now();
    let n = 0;
    for (const [id, session] of this.sessions) {
      if (session.expiresAt < now) {
        this.sessions.delete(id);
        n++;
      }
    }
    return n;
  }

  count(): number {
    return this.sessions.size;
  }
}

export const sessions = new SessionRepository();
