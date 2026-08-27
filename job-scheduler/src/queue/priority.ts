/**
 * Binary min-heap ordered by a caller supplied comparator.
 *
 * Used to keep runs sorted by (scheduledFor, -priority) so the scheduler
 * can peek at the next due item in O(1) and pop in O(log n).
 */
export class PriorityQueue<T> {
  private items: T[] = [];

  constructor(private readonly compare: (a: T, b: T) => number) {}

  get size(): number {
    return this.items.length;
  }

  peek(): T | undefined {
    return this.items[0];
  }

  push(item: T): void {
    this.items.push(item);
    this.siftUp(this.items.length - 1);
  }

  pop(): T | undefined {
    if (this.items.length === 0) return undefined;
    const top = this.items[0];
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      this.siftDown(0);
    }
    return top;
  }

  /** Remove the first item matching the predicate. */
  remove(predicate: (item: T) => boolean): T | undefined {
    const index = this.items.findIndex(predicate);
    if (index === -1) return undefined;
    const [removed] = this.items.splice(index, 1);
    if (index < this.items.length) {
      this.siftDown(index);
    }
    return removed;
  }

  toArray(): T[] {
    return [...this.items];
  }

  clear(): void {
    this.items = [];
  }

  private siftUp(index: number): void {
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.compare(this.items[index], this.items[parent]) >= 0) break;
      this.swap(index, parent);
      index = parent;
    }
  }

  private siftDown(index: number): void {
    const n = this.items.length;
    for (;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;

      if (left < n && this.compare(this.items[left], this.items[smallest]) < 0) {
        smallest = left;
      }
      if (right < n && this.compare(this.items[right], this.items[left]) < 0) {
        smallest = right;
      }
      if (smallest === index) break;

      this.swap(index, smallest);
      index = smallest;
    }
  }

  private swap(a: number, b: number): void {
    const tmp = this.items[a];
    this.items[a] = this.items[b];
    this.items[b] = tmp;
  }
}
