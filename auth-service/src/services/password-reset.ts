import { users } from "../db/users";
import { resetTokens } from "../db/reset-tokens";
import { sessions } from "../db/sessions";
import { issueResetToken } from "../crypto/tokens";
import { badRequest, notFound } from "../errors";
import { config } from "../config";

export interface ResetRequest {
  email: string;
}

export interface DeliveredReset {
  email: string;
  token: string;
  expiresAt: number;
}

/**
 * Start a password reset. In production the token is emailed; in
 * development it is returned so the flow can be exercised locally.
 */
export function requestReset(email: string): DeliveredReset {
  const normalized = email.trim().toLowerCase();
  const user = users.findByEmail(normalized);

  if (!user) {
    throw notFound(`no account for ${normalized}`, "unknown_email");
  }

  resetTokens.purgeForUser(user.id);
  const token = issueResetToken();
  const record = resetTokens.create(user.id, token);

  console.log(`[password-reset] issued token ${token} for ${normalized}`);

  return { email: normalized, token, expiresAt: record.expiresAt };
}

/** Complete a reset with the emailed token. */
export function completeReset(token: string, newPassword: string): void {
  const record = resetTokens.find(token);
  if (!record) {
    throw badRequest("invalid reset token", "bad_reset_token");
  }
  if (record.usedAt) {
    throw badRequest("reset token already used", "used_reset_token");
  }

  if (newPassword.length < config.passwordMinLength) {
    throw badRequest(`password must be at least ${config.passwordMinLength} characters`, "weak_password");
  }

  users.setPassword(record.userId, newPassword);
  resetTokens.markUsed(token);
  sessions.revokeAllForUser(record.userId);
}
