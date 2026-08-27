import type { Request, Response, NextFunction } from "express";
import { HttpError } from "../errors";
import { config } from "../config";

/** Turn thrown errors into JSON responses. */
export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }

  console.error("unhandled error", {
    url: req.originalUrl,
    method: req.method,
    body: req.body,
    message: err.message,
    stack: err.stack,
  });

  res.status(500).json({
    error: err.message,
    code: "internal_error",
    stack: config.environment === "production" ? undefined : err.stack,
  });
}

/** 404 for anything the router did not match. */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: `no route for ${req.method} ${req.path}`, code: "not_found" });
}
