import { createHash } from "node:crypto";
import type { Source } from "../types.js";
import { MemoryCache } from "./memory_cache.js";
import { DiskCache } from "./disk_cache.js";

export { MemoryCache } from "./memory_cache.js";
export { DiskCache } from "./disk_cache.js";

/**
 * Canonical key inputs. `sources` is sorted before hashing so that
 * ["arxiv", "pubmed"] and ["pubmed", "arxiv"] map to the same cache entry.
 */
export interface CacheKeyInput {
  tool: string;
  query: string;
  sources: Source[];
  date_from?: string;
  date_to?: string;
  max_results?: number;
}

export function buildCacheKey(input: CacheKeyInput): string {
  const canonical = {
    tool: input.tool,
    query: input.query.trim().toLowerCase(),
    sources: [...input.sources].sort(),
    date_from: input.date_from ?? null,
    date_to: input.date_to ?? null,
    max_results: input.max_results ?? null,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/**
 * Two-tier cache helper: memory first, then disk. On a disk hit the
 * value is promoted back into memory so subsequent lookups are fast.
 *
 * Stats lets the caller report a cache_hit_rate metric.
 */
export class SearchCache<T extends object = object> {
  readonly memory: MemoryCache<T>;
  readonly disk: DiskCache<T>;
  private hits = 0;
  private misses = 0;

  constructor(opts: {
    memoryMaxEntries?: number;
    memoryTtlMs?: number;
    diskPath?: string;
    diskTtlMs?: number;
  } = {}) {
    this.memory = new MemoryCache<T>(opts.memoryMaxEntries, opts.memoryTtlMs);
    this.disk = new DiskCache<T>(opts.diskPath, opts.diskTtlMs);
  }

  get(key: string): T | undefined {
    const m = this.memory.get(key);
    if (m !== undefined) {
      this.hits++;
      return m;
    }
    const d = this.disk.get(key);
    if (d !== undefined) {
      this.memory.set(key, d);
      this.hits++;
      return d;
    }
    this.misses++;
    return undefined;
  }

  set(key: string, value: T): void {
    this.memory.set(key, value);
    this.disk.set(key, value);
  }

  /** Hit rate over the lifetime of this cache instance. */
  hitRate(): number {
    const total = this.hits + this.misses;
    return total === 0 ? 0 : this.hits / total;
  }

  stats(): { hits: number; misses: number; rate: number } {
    return { hits: this.hits, misses: this.misses, rate: this.hitRate() };
  }

  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
  }

  close(): void {
    this.disk.close();
  }
}
