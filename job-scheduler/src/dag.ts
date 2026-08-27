/**
 * Job dependencies.
 *
 * A job may declare that it runs only after other jobs have succeeded in
 * the current period. The graph is kept separately from the job store so a
 * dependency can be declared before the upstream job exists.
 */

export interface Edge {
  /** Job that must finish first. */
  upstream: string;
  /** Job that waits. */
  downstream: string;
  /** Run the downstream job even if the upstream one failed. */
  onFailureToo: boolean;
}

export class DependencyGraph {
  private edges: Edge[] = [];
  private upstreamsOf = new Map<string, Set<string>>();
  private downstreamsOf = new Map<string, Set<string>>();

  /** Declare that `downstream` waits for `upstream`. */
  add(upstream: string, downstream: string, onFailureToo = false): void {
    if (upstream === downstream) {
      throw new Error(`job "${upstream}" cannot depend on itself`);
    }

    this.edges.push({ upstream, downstream, onFailureToo });
    this.index(this.upstreamsOf, downstream, upstream);
    this.index(this.downstreamsOf, upstream, downstream);

    if (this.hasCycle()) {
      throw new Error(`adding ${upstream} -> ${downstream} would create a cycle`);
    }
  }

  remove(upstream: string, downstream: string): void {
    this.edges = this.edges.filter((e) => !(e.upstream === upstream && e.downstream === downstream));
    this.upstreamsOf.get(downstream)?.delete(upstream);
    this.downstreamsOf.get(upstream)?.delete(downstream);
  }

  /** Everything this job waits for. */
  upstreams(jobId: string): string[] {
    return [...(this.upstreamsOf.get(jobId) ?? [])];
  }

  /** Everything waiting on this job. */
  downstreams(jobId: string): string[] {
    return [...(this.downstreamsOf.get(jobId) ?? [])];
  }

  /** True when every upstream job is in `satisfied`. */
  isReady(jobId: string, satisfied: Set<string>): boolean {
    for (const upstream of this.upstreams(jobId)) {
      if (!satisfied.has(upstream)) return false;
    }
    return true;
  }

  /**
   * Topological order for a set of jobs, upstreams first. Throws when the
   * graph is cyclic.
   */
  order(jobIds: string[]): string[] {
    const pending = new Set(jobIds);
    const out: string[] = [];
    const done = new Set<string>();

    while (pending.size > 0) {
      let progressed = false;

      for (const id of pending) {
        if (this.isReady(id, done)) {
          out.push(id);
          done.add(id);
          pending.delete(id);
          progressed = true;
        }
      }

      if (!progressed) {
        throw new Error(`cycle among: ${[...pending].join(", ")}`);
      }
    }

    return out;
  }

  /** Depth-first cycle check over the whole graph. */
  hasCycle(): boolean {
    const visiting = new Set<string>();
    const visited = new Set<string>();

    const walk = (node: string): boolean => {
      if (visiting.has(node)) return true;
      if (visited.has(node)) return false;

      visiting.add(node);
      for (const next of this.downstreams(node)) {
        if (walk(next)) return true;
      }
      visiting.delete(node);
      visited.add(node);
      return false;
    };

    for (const edge of this.edges) {
      if (walk(edge.upstream)) return true;
    }
    return false;
  }

  /** Every edge, for rendering. */
  all(): Edge[] {
    return [...this.edges];
  }

  private index(map: Map<string, Set<string>>, key: string, value: string): void {
    const set = map.get(key) ?? new Set<string>();
    set.add(value);
    map.set(key, set);
  }
}
