import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Persistent SQLite-backed cache for scholar_search results.
 *
 * Default location: ~/.scholar-mcp/cache/scholar_cache.db
 * Default TTL: 7 days
 *
 * Schema:
 *   key      TEXT PRIMARY KEY  -- sha256 of the canonical request
 *   value    TEXT NOT NULL     -- JSON-serialised payload
 *   created  INTEGER NOT NULL  -- epoch ms of insertion
 *   expires  INTEGER NOT NULL  -- epoch ms after which the row is stale
 */
export class DiskCache<T extends object = object> {
  private db: Database.Database;
  private ttlMs: number;

  constructor(dbPath?: string, ttlMs = 7 * 24 * 60 * 60 * 1000) {
    const resolved = dbPath ?? join(homedir(), ".scholar-mcp", "cache", "scholar_cache.db");
    mkdirSync(dirname(resolved), { recursive: true });
    this.db = new Database(resolved);
    this.ttlMs = ttlMs;
    this.init();
  }

  private init(): void {
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cache (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        created INTEGER NOT NULL,
        expires INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_cache_expires ON cache(expires);
    `);
  }

  get(key: string): T | undefined {
    const row = this.db
      .prepare<[string, number], { value: string }>(
        "SELECT value FROM cache WHERE key = ? AND expires > ?"
      )
      .get(key, Date.now());
    if (!row) return undefined;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return undefined;
    }
  }

  set(key: string, value: T): void {
    const now = Date.now();
    this.db
      .prepare(
        "INSERT OR REPLACE INTO cache (key, value, created, expires) VALUES (?, ?, ?, ?)"
      )
      .run(key, JSON.stringify(value), now, now + this.ttlMs);
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: string): void {
    this.db.prepare("DELETE FROM cache WHERE key = ?").run(key);
  }

  /** Remove all expired rows. Call periodically to keep the DB small. */
  prune(): number {
    const result = this.db.prepare("DELETE FROM cache WHERE expires <= ?").run(Date.now());
    return Number(result.changes);
  }

  clear(): void {
    this.db.exec("DELETE FROM cache");
  }

  get size(): number {
    const row = this.db
      .prepare<[number], { c: number }>("SELECT COUNT(*) AS c FROM cache WHERE expires > ?")
      .get(Date.now());
    return row?.c ?? 0;
  }

  close(): void {
    this.db.close();
  }
}
