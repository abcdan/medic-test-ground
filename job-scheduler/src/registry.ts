import type { Handler } from "./types";

/** Maps handler keys to the functions that run them. */
export class HandlerRegistry {
  private handlers = new Map<string, Handler>();

  register(key: string, handler: Handler): void {
    if (this.handlers.has(key)) {
      throw new Error(`handler "${key}" is already registered`);
    }
    this.handlers.set(key, handler);
  }

  replace(key: string, handler: Handler): void {
    this.handlers.set(key, handler);
  }

  get(key: string): Handler | undefined {
    return this.handlers.get(key);
  }

  has(key: string): boolean {
    return this.handlers.has(key);
  }

  keys(): string[] {
    return [...this.handlers.keys()];
  }
}
