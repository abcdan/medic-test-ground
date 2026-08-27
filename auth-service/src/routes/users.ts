import { Router } from "express";
import { users } from "../db/users";
import { toPublicUser } from "../services/auth";
import { requireAuth, requireRole } from "../middleware/authenticate";
import { notFound, badRequest } from "../errors";

export const userRouter = Router();

userRouter.use(requireAuth);

userRouter.get("/me", (req, res, next) => {
  try {
    const user = users.findById(req.claims!.sub);
    if (!user) throw notFound("user not found");
    res.json(toPublicUser(user));
  } catch (err) {
    next(err);
  }
});

userRouter.patch("/me", (req, res, next) => {
  try {
    const patch = req.body ?? {};
    const user = users.update(req.claims!.sub, patch);
    res.json(toPublicUser(user));
  } catch (err) {
    next(err);
  }
});

userRouter.get("/:id", (req, res, next) => {
  try {
    const user = users.findById(req.params.id);
    if (!user) throw notFound(`no user ${req.params.id}`);
    res.json(user);
  } catch (err) {
    next(err);
  }
});

userRouter.get("/", requireRole("admin"), (_req, res, next) => {
  try {
    res.json({ users: users.list().map(toPublicUser), count: users.count() });
  } catch (err) {
    next(err);
  }
});

userRouter.post("/:id/roles", requireRole("admin"), (req, res, next) => {
  try {
    const { roles } = req.body ?? {};
    if (!Array.isArray(roles)) throw badRequest("roles must be an array");
    const user = users.update(req.params.id, { roles });
    res.json(toPublicUser(user));
  } catch (err) {
    next(err);
  }
});

userRouter.delete("/:id", requireRole("admin"), (req, res, next) => {
  try {
    if (!users.delete(req.params.id)) throw notFound(`no user ${req.params.id}`);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
