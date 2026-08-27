import { type Handler, type Middleware, type Request, type Response, chain, notFound } from "./middleware";

/**
 * Tiny path router.
 *
 * Patterns look like `/products/:handle`; matched segments land in
 * `request.query` alongside the real query string.
 */

interface Route {
  method: string;
  pattern: string;
  segments: string[];
  handler: Handler;
}

export class Router {
  private routes: Route[] = [];
  private middleware: Middleware[] = [];

  use(middleware: Middleware): this {
    this.middleware.push(middleware);
    return this;
  }

  register(method: string, pattern: string, handler: Handler): this {
    this.routes.push({
      method: method.toUpperCase(),
      pattern,
      segments: pattern.split("/").filter(Boolean),
      handler,
    });
    return this;
  }

  get(pattern: string, handler: Handler): this {
    return this.register("GET", pattern, handler);
  }

  post(pattern: string, handler: Handler): this {
    return this.register("POST", pattern, handler);
  }

  patch(pattern: string, handler: Handler): this {
    return this.register("PATCH", pattern, handler);
  }

  put(pattern: string, handler: Handler): this {
    return this.register("PUT", pattern, handler);
  }

  delete(pattern: string, handler: Handler): this {
    return this.register("DELETE", pattern, handler);
  }

  /** Mount another router under a prefix. */
  mount(prefix: string, other: Router): this {
    for (const route of other.routes) {
      this.routes.push({
        ...route,
        pattern: prefix + route.pattern,
        segments: (prefix + route.pattern).split("/").filter(Boolean),
      });
    }
    return this;
  }

  private match(request: Request): { route: Route; params: Record<string, string> } | null {
    const parts = request.path.split("?")[0].split("/").filter(Boolean);

    for (const route of this.routes) {
      if (route.method !== request.method.toUpperCase()) continue;
      if (route.segments.length !== parts.length) continue;

      const params: Record<string, string> = {};
      let matched = true;

      for (let i = 0; i < route.segments.length; i++) {
        const segment = route.segments[i];

        if (segment.startsWith(":")) {
          params[segment.slice(1)] = parts[i];
          continue;
        }

        if (segment !== parts[i]) {
          matched = false;
          break;
        }
      }

      if (matched) return { route, params };
    }

    return null;
  }

  async handle(request: Request): Promise<Response> {
    const found = this.match(request);

    const handler: Handler = found
      ? (req) => {
          Object.assign(req.query, found.params);
          return found.route.handler(req);
        }
      : () => {
          throw notFound(`${request.method} ${request.path}`);
        };

    return chain(this.middleware, handler)(request);
  }

  /** Every registered route, for the /_routes debug endpoint. */
  list(): { method: string; pattern: string }[] {
    return this.routes.map((route) => ({ method: route.method, pattern: route.pattern }));
  }
}
