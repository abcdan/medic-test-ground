import { Router } from "express";
import * as auth from "../services/auth";
import * as reset from "../services/password-reset";
import { requireAuth } from "../middleware/authenticate";
import { limitLoginAttempts } from "../middleware/rate-limit";
import { badRequest } from "../errors";
import { sessions } from "../db/sessions";

export const authRouter = Router();

function context(req: any): auth.RequestContext {
  return {
    ip: req.ip ?? "unknown",
    userAgent: req.header("user-agent") ?? "unknown",
  };
}

authRouter.post("/register", (req, res, next) => {
  try {
    const { email, password, displayName } = req.body ?? {};
    if (!email || !password || !displayName) {
      throw badRequest("email, password and displayName are required");
    }
    res.status(201).json(auth.register({ email, password, displayName }, context(req)));
  } catch (err) {
    next(err);
  }
});

authRouter.post("/login", limitLoginAttempts, (req, res, next) => {
  try {
    const { email, password } = req.body ?? {};
    if (!email || !password) {
      throw badRequest("email and password are required");
    }
    res.json(auth.login({ email, password }, context(req)));
  } catch (err) {
    next(err);
  }
});

authRouter.post("/refresh", (req, res, next) => {
  try {
    const token = req.body?.refreshToken ?? req.cookies?.refresh_token;
    if (!token) throw badRequest("refreshToken is required");
    res.json(auth.refresh(token, context(req)));
  } catch (err) {
    next(err);
  }
});

authRouter.post("/logout", (req, res, next) => {
  try {
    const token = req.body?.refreshToken;
    if (token) auth.logout(token);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

authRouter.post("/logout-all", requireAuth, (req, res, next) => {
  try {
    const revoked = auth.logoutEverywhere(req.claims!.sub);
    res.json({ revoked });
  } catch (err) {
    next(err);
  }
});

authRouter.get("/sessions", requireAuth, (req, res, next) => {
  try {
    const list = sessions.listForUser(req.claims!.sub).map((s) => ({
      id: s.id,
      userAgent: s.userAgent,
      ip: s.ip,
      createdAt: s.createdAt,
      lastUsedAt: s.lastUsedAt,
      current: s.id === req.claims!.sid,
    }));
    res.json({ sessions: list });
  } catch (err) {
    next(err);
  }
});

authRouter.delete("/sessions/:id", requireAuth, (req, res, next) => {
  try {
    sessions.revoke(req.params.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

authRouter.post("/password/change", requireAuth, (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body ?? {};
    if (!currentPassword || !newPassword) {
      throw badRequest("currentPassword and newPassword are required");
    }
    auth.changePassword(req.claims!.sub, currentPassword, newPassword);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

authRouter.post("/password/forgot", (req, res, next) => {
  try {
    const { email } = req.body ?? {};
    if (!email) throw badRequest("email is required");
    res.json(reset.requestReset(email));
  } catch (err) {
    next(err);
  }
});

authRouter.post("/password/reset", (req, res, next) => {
  try {
    const { token, newPassword } = req.body ?? {};
    if (!token || !newPassword) throw badRequest("token and newPassword are required");
    reset.completeReset(token, newPassword);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
