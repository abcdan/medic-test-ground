import express from "express";
import { authRouter } from "./routes/auth";
import { userRouter } from "./routes/users";
import { errorHandler, notFoundHandler } from "./middleware/errors";
import { config } from "./config";
import { users } from "./db/users";
import { sessions } from "./db/sessions";

export function createApp() {
  const app = express();

  app.use(express.json({ limit: "1mb" }));

  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", config.corsOrigin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
    if (req.method === "OPTIONS") return res.status(204).end();
    next();
  });

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      environment: config.environment,
      users: users.count(),
      sessions: sessions.count(),
    });
  });

  app.use("/auth", authRouter);
  app.use("/users", userRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
