import { LRUCache } from "lru-cache";

/**
 * In-process LRU cache for scholar_search results.
 *
 * - Capacity: 1000 entries
 * - TTL: 1 hour
 * - Stores arbitrary JSON-serialisable values keyed by sha256 hash
 */
export class MemoryCache<T extends object = object> {
  private cache: LRUCache<string, T>;

  constructor(maxEntries = 1000, ttlMs = 60 * 60 * 1000) {
    this.cache = new LRUCache<string, T>({
      max: maxEntries,
      ttl: ttlMs,
    });
  }

  get(key: string): T | undefined {
    return this.cache.get(key);
  }

  set(key: string, value: T): void {
    this.cache.set(key, value);
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}
