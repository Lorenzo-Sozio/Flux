import { neon } from "@neondatabase/serverless";
import type { SQLWrapper } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { isNeonUrl, sslFor } from "@/lib/db-ssl";

import * as platformSchema from "./schema";
import * as tenantSchema from "./schema-tenant";

/**
 * Two drivers, chosen by the connection string.
 *
 * Neon is reached over HTTP: one request per statement, no connection to keep, which
 * is what makes it work inside a Worker isolate that may not outlive the request.
 * Everything else — Railway, a container, a laptop — is ordinary Postgres over TCP and
 * needs a pool.
 *
 * ⚠️ **They are not the same database object.** The declared type stays
 * `NeonHttpDatabase` because seven modules and every action are written against it and
 * the query builders are identical; the pooled one is given the one method it lacks
 * (`batch`) and then presented as the same shape. The lie is contained here.
 */
export type AppDatabase<S extends Record<string, unknown>> = NeonHttpDatabase<S>;

/**
 * ⚠️⚠️ `db.batch([...])` has to stay **atomic**, because that is what the callers were
 * written against: a quote replaces its lines with a delete and an insert, and a half
 * of that is a quote with no lines and a total that no longer matches anything. Neon's
 * HTTP driver maps `batch` onto its transaction endpoint. The pooled driver has no
 * `batch` at all, so it is built here out of a real transaction on a single connection.
 *
 * The statements are taken as SQL rather than run through the builders, because a
 * builder is bound to the pool and would take its own connection — committing outside
 * the transaction it was supposed to be part of, silently.
 */
function batchOnPool(pool: Pool) {
  return async (queries: readonly SQLWrapper[]): Promise<unknown[]> => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const results: unknown[] = [];
      for (const query of queries) {
        const { sql, params } = (query as unknown as { toSQL(): { sql: string; params: unknown[] } }).toSQL();
        const result = await client.query(sql, params as never[]);
        results.push(result.rows);
      }
      await client.query("commit");
      return results;
    } catch (error) {
      await client.query("rollback").catch(() => {
        // The connection is going back to the pool either way; the original error is
        // the one worth raising.
      });
      throw error;
    } finally {
      client.release();
    }
  };
}

function connect<S extends Record<string, unknown>>(url: string, schema: S): AppDatabase<S> {
  if (isNeonUrl(url)) return drizzleNeon(neon(url), { schema });

  const pool = new Pool({
    connectionString: url,
    ssl: sslFor(url),
    // Small on purpose: a serverless instance holds a pool per isolate, and a managed
    // Postgres counts every one of them against the same limit.
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  const db = drizzlePg(pool, { schema });
  Object.assign(db, { batch: batchOnPool(pool) });
  return db as unknown as AppDatabase<S>;
}

// Platform DB — tenant registry, lives on DATABASE_URL
export const platformDb = connect(process.env.DATABASE_URL ?? "", platformSchema);

// ─── Tenant DB factory ────────────────────────────────────────────────────────
// Cache is keyed by tenantId; each entry is a long-lived drizzle instance. Neon HTTP
// is stateless and safe to reuse across requests; the pooled driver is cached for the
// stronger reason that a pool per request would open a connection per request.
// Uses tenantSchema (no platform-only tables) so queries against tenant DBs
// cannot accidentally reference tenants/billingPlans/etc.
const tenantDbCache = new Map<string, AppDatabase<typeof tenantSchema>>();

export function createTenantDb(tenantId: string, decryptedUrl: string) {
  let tenantDb = tenantDbCache.get(tenantId);
  if (!tenantDb) {
    tenantDb = connect(decryptedUrl, tenantSchema);
    tenantDbCache.set(tenantId, tenantDb);
  }
  return tenantDb;
}

export function invalidateTenantDbCache(tenantId: string): void {
  tenantDbCache.delete(tenantId);
}
