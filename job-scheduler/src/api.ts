import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Scheduler } from "./scheduler";

/**
 * Minimal admin API. Not meant to face the internet; put it behind the
 * cluster's internal load balancer.
 */
export function createAdminApi(scheduler: Scheduler) {
  return createServer((req, res) => {
    void handle(scheduler, req, res).catch((err) => {
      json(res, 500, { error: err.message });
    });
  });
}

async function handle(scheduler: Scheduler, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;

  if (req.method === "GET" && path === "/stats") {
    return json(res, 200, scheduler.stats());
  }

  if (req.method === "GET" && path === "/metrics") {
    return json(res, 200, scheduler.metrics.snapshot());
  }

  if (req.method === "GET" && path === "/jobs") {
    return json(res, 200, { jobs: scheduler.jobs.list() });
  }

  if (req.method === "POST" && path === "/jobs") {
    const body = await readJson(req);
    return json(res, 201, scheduler.define(body as never));
  }

  if (req.method === "GET" && path.startsWith("/jobs/")) {
    const id = path.slice("/jobs/".length);
    const job = scheduler.jobs.get(id) ?? scheduler.jobs.getByName(id);
    if (!job) return json(res, 404, { error: `no job ${id}` });
    return json(res, 200, { job, runs: scheduler.runs.list({ jobId: job.id, limit: 20 }) });
  }

  if (req.method === "POST" && path.startsWith("/trigger/")) {
    const id = path.slice("/trigger/".length);
    return json(res, 202, scheduler.trigger(id));
  }

  if (req.method === "DELETE" && path.startsWith("/jobs/")) {
    const id = path.slice("/jobs/".length);
    scheduler.disable(id);
    return json(res, 204, {});
  }

  json(res, 404, { error: `no route for ${req.method} ${path}` });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) });
  res.end(payload);
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}
