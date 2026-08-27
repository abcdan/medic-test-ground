import { config } from "../config";

export interface ResetToken {
  token: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
}

/** Password reset tokens, keyed by the token itself. */
export class ResetTokenRepository {
  private tokens = new Map<string, ResetToken>();

  create(userId: string, token: string): ResetToken {
    const now = Date.now();
    const record: ResetToken = {
      token,
      userId,
      createdAt: now,
      expiresAt: now + config.resetTokenTtlSeconds * 1000,
      usedAt: null,
    };
    this.tokens.set(token, record);
    return record;
  }

  find(token: string): ResetToken | undefined {
    return this.tokens.get(token);
  }

  markUsed(token: string): void {
    const record = this.tokens.get(token);
    if (record) record.usedAt = Date.now();
  }

  purgeForUser(userId: string): void {
    for (const [token, record] of this.tokens) {
      if (record.userId === userId) this.tokens.delete(token);
    }
  }

  count(): number {
    return this.tokens.size;
  }
}

export const resetTokens = new ResetTokenRepository();
