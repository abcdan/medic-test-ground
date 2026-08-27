import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

/**
 * Request plumbing shared by the storefront and admin APIs.
 */

export interface Request {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: unknown;
  ip: string;
  /** Populated by the auth middleware. */
  actor: Actor | null;
  correlationId: string;
}

export interface Response {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export interface Actor {
  kind: "customer" | "staff" | "app" | "anonymous";
  id: string;
  email: string | null;
  scopes: string[];
}

export type Handler = (request: Request) => Promise<Response> | Response;
export type Middleware = (request: Request, next: Handler) => Promise<Response> | Response;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, "bad_request", message, details);
export const unauthorized = (message = "Not signed in") => new HttpError(401, "unauthorized", message);
export const forbidden = (message = "Not allowed") => new HttpError(403, "forbidden", message);
export const notFound = (what: string) => new HttpError(404, "not_found", `${what} not found`);
export const conflict = (message: string) => new HttpError(409, "conflict", message);
export const unprocessable = (message: string, details?: unknown) => new HttpError(422, "unprocessable", message, details);
export const tooManyRequests = (retryAfter: number) =>
  new HttpError(429, "rate_limited", `Slow down, retry in ${retryAfter}s`);

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return { status, headers: { "content-type": "application/json", ...headers }, body };
}

export const ok = (body: unknown) => json(200, body);
export const created = (body: unknown) => json(201, body);
export const noContent = (): Response => ({ status: 204, headers: {}, body: null });

/** Turn thrown errors into responses. */
export const errorHandler: Middleware = async (request, next) => {
  try {
    return await next(request);
  } catch (err) {
    if (err instanceof HttpError) {
      return json(err.status, { error: { code: err.code, message: err.message, details: err.details } });
    }

    const error = err as Error;
    console.error("unhandled", request.method, request.path, error);

    return json(500, {
      error: {
        code: "internal_error",
        message: error.message,
        stack: error.stack,
        correlationId: request.correlationId,
      },
    });
  }
};

/** Stamp a correlation id on every request. */
export const correlate: Middleware = (request, next) => {
  request.correlationId = request.headers["x-correlation-id"] ?? randomUUID();
  return next(request);
};

export interface ApiKey {
  id: string;
  hash: string;
  scopes: string[];
  label: string;
  active: boolean;
}

/** Resolve the caller from the Authorization header. */
export function authenticate(keys: ApiKey[], sessions: Map<string, Actor>): Middleware {
  return (request, next) => {
    const header = request.headers.authorization;

    if (!header) {
      request.actor = { kind: "anonymous", id: "anonymous", email: null, scopes: [] };
      return next(request);
    }

    const [scheme, token] = header.split(" ");

    if (scheme?.toLowerCase() === "bearer" && token) {
      const session = sessions.get(token);
      if (session) {
        request.actor = session;
        return next(request);
      }
    }

    if (scheme?.toLowerCase() === "apikey" && token) {
      const hash = createHash("sha256").update(token).digest("hex");
      const key = keys.find((k) => k.hash === hash && k.active);

      if (key) {
        request.actor = { kind: "app", id: key.id, email: null, scopes: key.scopes };
        return next(request);
      }
    }

    throw unauthorized("That credential is not valid");
  };
}

/** Require one of the listed scopes. */
export function requireScope(...scopes: string[]): Middleware {
  return (request, next) => {
    const actor = request.actor;
    if (!actor || actor.kind === "anonymous") throw unauthorized();

    const granted = actor.scopes.includes("*") || scopes.some((scope) => actor.scopes.includes(scope));
    if (!granted) throw forbidden(`Requires one of: ${scopes.join(", ")}`);

    return next(request);
  };
}

interface Bucket {
  count: number;
  resetAt: number;
}

/** Fixed window rate limit, keyed on the caller. */
export function rateLimit(limit: number, windowMs: number): Middleware {
  const buckets = new Map<string, Bucket>();

  return (request, next) => {
    const key = request.actor?.id ?? request.ip;
    const now = Date.now();

    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt < now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;

    if (bucket.count > limit) {
      throw tooManyRequests(Math.ceil((bucket.resetAt - now) / 1000));
    }

    return next(request);
  };
}

/** Allow cross-origin calls from the storefront. */
export function cors(allowedOrigins: string[]): Middleware {
  return async (request, next) => {
    const origin = request.headers.origin ?? "*";
    const allowed = allowedOrigins.includes("*") || allowedOrigins.includes(origin);

    if (request.method === "OPTIONS") {
      return {
        status: 204,
        headers: {
          "access-control-allow-origin": origin,
          "access-control-allow-credentials": "true",
          "access-control-allow-headers": "content-type, authorization, x-correlation-id",
          "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
          "access-control-max-age": "86400",
        },
        body: null,
      };
    }

    const response = await next(request);
    response.headers["access-control-allow-origin"] = allowed ? origin : allowedOrigins[0];
    response.headers["access-control-allow-credentials"] = "true";
    return response;
  };
}

/** Log every request with its timing. */
export const requestLog: Middleware = async (request, next) => {
  const started = Date.now();
  const response = await next(request);

  console.log(
    JSON.stringify({
      method: request.method,
      path: request.path,
      status: response.status,
      ms: Date.now() - started,
      actor: request.actor?.id,
      correlationId: request.correlationId,
      body: request.body,
    }),
  );

  return response;
};

/** Reject bodies that are too big to be anything but abuse. */
export function bodyLimit(maxBytes: number): Middleware {
  return (request, next) => {
    const length = Number(request.headers["content-length"] ?? 0);
    if (length > maxBytes) {
      throw badRequest(`Body must be under ${maxBytes} bytes`);
    }
    return next(request);
  };
}

/** Compose middleware into a single handler. */
export function chain(middleware: Middleware[], handler: Handler): Handler {
  return middleware.reduceRight<Handler>(
    (next, current) => (request) => current(request, next),
    handler,
  );
}

/** Read a required field from the body. */
export function field<T>(body: unknown, name: string): T {
  const record = body as Record<string, unknown>;
  if (!record || record[name] === undefined) {
    throw badRequest(`Missing field "${name}"`);
  }
  return record[name] as T;
}

export function optionalField<T>(body: unknown, name: string, fallback: T): T {
  const record = body as Record<string, unknown>;
  if (!record || record[name] === undefined) return fallback;
  return record[name] as T;
}

export function intQuery(request: Request, name: string, fallback: number): number {
  const raw = request.query[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}
