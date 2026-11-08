// Persistent response cache for the API routes, on Node's built-in SQLite
// (node:sqlite, no extra dependency). Server-only: import it from route
// handlers and server helpers, never from client components.
//
// Each route keeps its own namespace. Reads check a small in-memory layer
// first, then the database, so a restarted dev server answers repeat requests
// (weather, NWS, incidents, Gemini suggestions…) without calling providers
// again. If the database can't be opened (e.g. a read-only host), the cache
// silently degrades to memory only.

import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ExpiringCache } from "./validation";

const DB_PATH = process.env.ROADSALT_DB_PATH?.trim() || path.join(process.cwd(), ".data", "roadsalt.db");

type Store = { db: DatabaseSync } | { db: null; reason: string };
const globalStore = globalThis as { __roadsaltCacheDb?: Store };

/** One shared connection per server process (survives dev hot reloads). */
function store(): Store {
  if (globalStore.__roadsaltCacheDb) return globalStore.__roadsaltCacheDb;
  try {
    mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const db = new DatabaseSync(DB_PATH);
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS cache (
        namespace  TEXT    NOT NULL,
        key        TEXT    NOT NULL,
        value      TEXT    NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        hits       INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (namespace, key)
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS cache_expires_at ON cache (expires_at);
    `);
    globalStore.__roadsaltCacheDb = { db };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`[cache-db] SQLite unavailable, using memory only: ${reason}`);
    globalStore.__roadsaltCacheDb = { db: null, reason };
  }
  return globalStore.__roadsaltCacheDb;
}

let writesSincePurge = 0;

function purgeExpired(db: DatabaseSync) {
  db.prepare("DELETE FROM cache WHERE expires_at <= ?").run(Date.now());
}

export class PersistentCache<V> {
  private readonly memory: ExpiringCache<V>;

  constructor(
    private readonly namespace: string,
    maxMemoryEntries: number,
    private readonly ttlMs: number,
  ) {
    this.memory = new ExpiringCache<V>(maxMemoryEntries, ttlMs);
  }

  get(key: string): V | undefined {
    const hot = this.memory.get(key);
    if (hot !== undefined) return hot;
    const { db } = store();
    if (!db) return undefined;
    try {
      const row = db
        .prepare("SELECT value, expires_at FROM cache WHERE namespace = ? AND key = ? AND expires_at > ?")
        .get(this.namespace, key, Date.now()) as { value: string; expires_at: number } | undefined;
      if (!row) return undefined;
      db.prepare("UPDATE cache SET hits = hits + 1 WHERE namespace = ? AND key = ?").run(this.namespace, key);
      const value = JSON.parse(row.value) as V;
      this.memory.set(key, value, row.expires_at - Date.now());
      return value;
    } catch (error) {
      console.warn(`[cache-db] read failed (${this.namespace}):`, error);
      return undefined;
    }
  }

  set(key: string, value: V): void {
    this.memory.set(key, value);
    const { db } = store();
    if (!db) return;
    try {
      const now = Date.now();
      db.prepare(
        `INSERT INTO cache (namespace, key, value, created_at, expires_at, hits) VALUES (?, ?, ?, ?, ?, 0)
         ON CONFLICT (namespace, key) DO UPDATE SET value = excluded.value, created_at = excluded.created_at,
           expires_at = excluded.expires_at`,
      ).run(this.namespace, key, JSON.stringify(value), now, now + this.ttlMs);
      writesSincePurge += 1;
      if (writesSincePurge >= 200) {
        writesSincePurge = 0;
        purgeExpired(db);
      }
    } catch (error) {
      console.warn(`[cache-db] write failed (${this.namespace}):`, error);
    }
  }
}

export type CacheStats = {
  storage: "sqlite" | "memory";
  path: string | null;
  note: string | null;
  namespaces: { namespace: string; entries: number; bytes: number; hits: number; newest: string | null }[];
};

/** Live entries per namespace (for GET /api/cache). */
export function cacheStats(): CacheStats {
  const current = store();
  if ("reason" in current) return { storage: "memory", path: null, note: current.reason, namespaces: [] };
  purgeExpired(current.db);
  const rows = current.db
    .prepare(
      `SELECT namespace, COUNT(*) AS entries, SUM(LENGTH(value)) AS bytes, SUM(hits) AS hits, MAX(created_at) AS newest
       FROM cache GROUP BY namespace ORDER BY namespace`,
    )
    .all() as { namespace: string; entries: number; bytes: number; hits: number; newest: number | null }[];
  return {
    storage: "sqlite",
    path: path.relative(process.cwd(), DB_PATH),
    note: null,
    namespaces: rows.map((row) => ({
      namespace: row.namespace,
      entries: Number(row.entries),
      bytes: Number(row.bytes ?? 0),
      hits: Number(row.hits ?? 0),
      newest: row.newest ? new Date(Number(row.newest)).toISOString() : null,
    })),
  };
}
