import { Pool, type PoolConfig } from "pg";

import { compareCanonicalStrings } from "./canonical.ts";

import {
  GUARD_COLLECTIONS,
  type GuardCollection,
  type GuardCollectionName,
  type GuardStore,
} from "./store.ts";

/**
 * Postgres adapter — the first store that is safe for concurrent writers.
 *
 * It is deliberately provider-neutral. Any Postgres reachable over
 * `DATABASE_URL` works: a managed database from a platform marketplace, Neon,
 * Supabase, or one you run yourself. Nothing here names a vendor, because
 * binding the settlement-evidence store to one hosting company would be a
 * strange thing for a provider-neutral evidence layer to do.
 *
 * One table, keyed by (collection, key), holding the same JSON objects the
 * other adapters hold. At prototype volume a relational schema per object type
 * would buy nothing and would fix the shape of contracts that are still
 * PROVISIONAL; a key-value table keeps the kernel the single authority on what
 * an object means.
 *
 * The reason this adapter exists at all is `insertIfAbsent`. Read-then-write
 * cannot claim an idempotency key or a transaction hash across two instances —
 * both readers see the key free. `INSERT … ON CONFLICT DO NOTHING` decides that
 * race inside the database, once, for every writer.
 */

const TABLE = "guard_objects";

export type PostgresGuardStoreOptions = {
  connectionString: string;
  /** Overrides for tests or an operator with unusual pool requirements. */
  poolConfig?: Omit<PoolConfig, "connectionString" | "ssl">;
};

function isLocalConnection(connectionString: string): boolean {
  try {
    const host = new URL(connectionString).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

const CONNECTION_STRING_TLS_PARAMETERS = new Set([
  "ssl",
  "sslmode",
  "sslcert",
  "sslkey",
  "sslrootcert",
  "uselibpqcompat",
]);

function normalizeRemoteConnectionString(connectionString: string): string {
  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error("A Postgres Guard store requires a valid absolute connection string.");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("A Postgres Guard store requires a postgres:// or postgresql:// URL.");
  }
  if (["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) return connectionString;
  for (const key of [...parsed.searchParams.keys()]) {
    if (CONNECTION_STRING_TLS_PARAMETERS.has(key.toLowerCase())) {
      parsed.searchParams.delete(key);
    }
  }
  return parsed.toString();
}

export function postgresGuardPoolConfig(options: PostgresGuardStoreOptions): PoolConfig {
  const { connectionString } = options;
  if (!connectionString.trim()) {
    throw new Error("A Postgres Guard store requires a non-empty connection string.");
  }
  const local = isLocalConnection(connectionString);
  return {
    max: 4,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    ...options.poolConfig,
    /* pg parses connectionString after object fields. Keep these fields
       security-owned even for untyped JavaScript callers. */
    connectionString: normalizeRemoteConnectionString(connectionString),
    ssl: local ? undefined : { rejectUnauthorized: true },
  };
}

export function createPostgresGuardStore(options: PostgresGuardStoreOptions): GuardStore {
  /* Remote connections always use verified TLS against the system trust store.
     URL TLS flags are normalized out before pg can override this object. */
  const pool = new Pool(postgresGuardPoolConfig(options));

  /* Readiness is checked once per process and awaited by every caller that races
     it. A store that silently served reads before its table existed would fail
     as "no rows" — indistinguishable from a genuinely absent lifecycle, which
     is the one error this system must never fake. Runtime requests never run
     DDL; provisioning is a separately authorized migration. */
  let ready: Promise<void> | null = null;
  function ensureReady(): Promise<void> {
    ready ??= pool
      .query(`SELECT collection, key, value FROM ${TABLE} LIMIT 0`)
      .then(() => undefined)
      .catch((error: unknown) => {
        /* Clear the memo so a transient failure at startup does not poison the
           process for its whole life. */
        ready = null;
        throw new Error(
          "Postgres Guard schema is unavailable; apply the separately authorized guard_objects migration first.",
          { cause: error },
        );
      });
    return ready;
  }

  function collection<T>(name: GuardCollectionName): GuardCollection<T> {
    return {
      async get(key) {
        await ensureReady();
        const result = await pool.query<{ value: T }>(
          `SELECT value FROM ${TABLE} WHERE collection = $1 AND key = $2`,
          [name, key],
        );
        return result.rows[0]?.value;
      },

      async set(key, value) {
        await ensureReady();
        await pool.query(
          `INSERT INTO ${TABLE} (collection, key, value) VALUES ($1, $2, $3)
           ON CONFLICT (collection, key)
           DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
          [name, key, JSON.stringify(value)],
        );
      },

      async insertIfAbsent(key, value) {
        await ensureReady();
        const result = await pool.query(
          `INSERT INTO ${TABLE} (collection, key, value) VALUES ($1, $2, $3)
           ON CONFLICT (collection, key) DO NOTHING`,
          [name, key, JSON.stringify(value)],
        );
        return (result.rowCount ?? 0) === 1;
      },

      async insertAllIfAbsent(entries) {
        await ensureReady();
        const ordered = [...entries].sort((left, right) =>
          compareCanonicalStrings(left.key, right.key),
        );
        const keys = new Set(ordered.map((entry) => entry.key));
        if (keys.size !== ordered.length) {
          throw new TypeError("Guard batch claims require unique keys.");
        }
        if (ordered.length === 0) return true;

        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          for (const entry of ordered) {
            const result = await client.query(
              `INSERT INTO ${TABLE} (collection, key, value) VALUES ($1, $2, $3)
               ON CONFLICT (collection, key) DO NOTHING`,
              [name, entry.key, JSON.stringify(entry.value)],
            );
            if ((result.rowCount ?? 0) !== 1) {
              await client.query("ROLLBACK");
              return false;
            }
          }
          await client.query("COMMIT");
          return true;
        } catch (error) {
          try {
            await client.query("ROLLBACK");
          } catch {
            // Preserve the original transaction error.
          }
          throw error;
        } finally {
          client.release();
        }
      },

      async delete(key) {
        await ensureReady();
        await pool.query(`DELETE FROM ${TABLE} WHERE collection = $1 AND key = $2`, [name, key]);
      },

      async has(key) {
        await ensureReady();
        const result = await pool.query(
          `SELECT 1 FROM ${TABLE} WHERE collection = $1 AND key = $2`,
          [name, key],
        );
        return (result.rowCount ?? 0) > 0;
      },

      async valuesWithPrefix(keyPrefix) {
        await ensureReady();
        /* `like_escape` keeps a tenant id containing % or _ from widening the
           scan into another tenant's rows. Ordering by insertion keeps
           "latest wins" readers deterministic across instances. */
        const result = await pool.query<{ value: T }>(
          `SELECT value FROM ${TABLE}
           WHERE collection = $1 AND key LIKE $2 ESCAPE '\\'
           ORDER BY created_at, key`,
          [name, `${keyPrefix.replace(/[\\%_]/g, "\\$&")}%`],
        );
        return result.rows.map((row) => row.value);
      },
    };
  }

  return {
    durability: "DURABLE_MULTI_WRITER",
    description: "Postgres (shared table, safe for concurrent instances)",
    collection,
    async close() {
      await pool.end();
    },
  };
}

/** Every collection name, exported so a migration or an audit can enumerate them. */
export const POSTGRES_GUARD_COLLECTIONS = GUARD_COLLECTIONS;
