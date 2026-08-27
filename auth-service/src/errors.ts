/** Errors that carry an HTTP status so the error handler can map them. */

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (msg: string, code = "bad_request") => new HttpError(400, msg, code);
export const unauthorized = (msg: string, code = "unauthorized") => new HttpError(401, msg, code);
export const forbidden = (msg: string, code = "forbidden") => new HttpError(403, msg, code);
export const notFound = (msg: string, code = "not_found") => new HttpError(404, msg, code);
export const conflict = (msg: string, code = "conflict") => new HttpError(409, msg, code);
export const tooManyRequests = (msg: string, code = "rate_limited") => new HttpError(429, msg, code);
