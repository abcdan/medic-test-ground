import type { Request, Response, NextFunction } from "express";
import { authenticate as resolveToken } from "../services/auth";
import type { JwtClaims } from "../crypto/tokens";
import { forbidden, unauthorized } from "../errors";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      claims?: JwtClaims;
    }
  }
}

/** Require a valid bearer token. Populates req.claims. */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.header("authorization");
  if (!header) {
    return next(unauthorized("missing authorization header", "no_token"));
  }

  const [scheme, token] = header.split(" ");
  if (scheme.toLowerCase() !== "bearer" || !token) {
    return next(unauthorized("expected a bearer token", "no_token"));
  }

  try {
    req.claims = resolveToken(token);
    next();
  } catch (err) {
    next(err);
  }
}

/** Require the caller to hold one of the given roles. */
export function requireRole(...allowed: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const roles = req.claims?.roles ?? [];
    if (!roles.some((r) => allowed.includes(r))) {
      return next(forbidden(`requires one of: ${allowed.join(", ")}`, "insufficient_role"));
    }
    next();
  };
}

/** Attach claims when present, but do not require them. */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.header("authorization");
  if (!header) return next();
  const [, token] = header.split(" ");
  if (!token) return next();
  try {
    req.claims = resolveToken(token);
  } catch {
    // anonymous
  }
  next();
}
