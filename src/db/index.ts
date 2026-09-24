import { neon } from "@neondatabase/serverless";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { SQLWrapper } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { isNeonUrl, sslFor } from "@/lib/db-ssl";
import { parseDbUrl } from "@/lib/db-url";

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

/**
 * ⚠️⚠️ **A Worker cannot open a TLS connection to Railway's proxy.** Tried on the real
 * runtime: the plaintext connection succeeds and the encrypted one dies with
 * "Connection terminated unexpectedly". So on Workers the connection goes through
 * **Hyperdrive**, which holds the connections and terminates the TLS itself, verifying
 * Railway's self-signed certificate against the CA uploaded to the account
 * (`sslmode=verify-ca`). Its own connection string never leaves Cloudflare's network,
 * which is why it carries no TLS options of ours.
 *
 * One binding per database, named after the database: `flux_demo` →
 * `HYPERDRIVE_FLUX_DEMO`. ⚠️ Bindings are static, so a new workspace needs
 * `wrangler hyperdrive create` **and a deploy** — the cost of this arrangement, and the
 * reason it is a stop on the way rather than a destination.
 *
 * Off Workers — the dev server, the scripts, a Node host — there is no context and the
 * connection string is used as it stands.
 */
function throughHyperdrive(url: string, preferred?: string): string | null {
  const database = parseDbUrl(url)?.database;
  if (!database && !preferred) return null;
  // ⚠️ The registry's own binding is named for what it *is*, not for the database it
  // happens to live in: it was `HYPERDRIVE_PLATFORM` against a database called
  // `railway`, the derived name found nothing, and every query quietly went back to the
  // direct connection — the one a Worker cannot make. Hence a name passed in, and the
  // derived one only as a fallback.
  const derived = database ? `HYPERDRIVE_${database.toUpperCase().replace(/[^A-Z0-9]/g, "_")}` : null;

  try {
    // ⚠️ Statically imported at the top of this file, not `require`d here: the Worker
    // bundle is ESM and its runtime has no `require`, so the dynamic form threw on
    // every call and this very catch swallowed it — the Worker went on using the direct
    // connection string, which is the one that does not work. Off Workers the call
    // throws for a real reason (there is no request context) and the catch is right.
    const env = getCloudflareContext().env as unknown as Record<string, { connectionString?: string } | undefined>;
    for (const name of [preferred, derived]) {
      const connectionString = name ? env[name]?.connectionString : undefined;
      if (connectionString) return connectionString;
    }
    return null;
  } catch {
    return null;
  }
}

function connect<S extends Record<string, unknown>>(
  url: string,
  schema: S,
  options: { viaHyperdrive?: boolean } = {},
): AppDatabase<S> {
  if (isNeonUrl(url)) return drizzleNeon(neon(url), { schema });

  const pool = new Pool({
    connectionString: url,
    // ⚠️ Told, not guessed from the string: Hyperdrive is reached inside Cloudflare's
    // own network, where a certificate of ours means nothing; everything else keeps the
    // pinned CA.
    ssl: options.viaHyperdrive ? false : sslFor(url),
    // Small on purpose: a serverless instance holds a pool per isolate, and a managed
    // Postgres counts every one of them against the same limit.
    // ⚠️ One connection per request on Workers, where the pool cannot outlive the
    // invocation anyway; a handful elsewhere, where it can.
    max: options.viaHyperdrive ? 1 : 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  const db = drizzlePg(pool, { schema });
  Object.assign(db, { batch: batchOnPool(pool) });
  return db as unknown as AppDatabase<S>;
}

/** One instance per connection string, off Workers, where a process outlives the request. */
const byUrl = new Map<string, unknown>();

/**
 * ⚠️⚠️ **On Workers a connection may not be reused between requests.** The socket is
 * closed when the invocation ends, so a pool kept in the isolate hands the next request
 * a dead one and the query fails with "Connection terminated unexpectedly" — which is
 * exactly how this looked: Hyperdrive bound, three hand-written connections through it
 * working, and every real query failing.
 *
 * So there the instance is keyed to the request itself, through the execution context,
 * and goes away with it. Hyperdrive keeps the pool to the database on its side, which
 * is the whole reason it exists.
 */
const byRequest = new WeakMap<object, Map<string, unknown>>();

function cacheFor(url: string): Map<string, unknown> {
  try {
    const { ctx } = getCloudflareContext() as unknown as { ctx: object };
    if (ctx) {
      let perRequest = byRequest.get(ctx);
      if (!perRequest) {
        perRequest = new Map();
        byRequest.set(ctx, perRequest);
      }
      return perRequest;
    }
  } catch {
    // Not on Workers: the process-wide cache is right, and reuse is the point.
  }
  void url;
  return byUrl;
}

function instanceFor<S extends Record<string, unknown>>(
  url: string,
  schema: S,
  preferredBinding?: string,
): AppDatabase<S> {
  const pooled = throughHyperdrive(url, preferredBinding);
  const effective = pooled ?? url;
  const cache = cacheFor(effective);
  let db = cache.get(effective) as AppDatabase<S> | undefined;
  if (!db) {
    db = connect(effective, schema, { viaHyperdrive: pooled !== null });
    cache.set(effective, db);
  }
  return db;
}

/**
 * Platform DB — the tenant registry, on DATABASE_URL.
 *
 * ⚠️⚠️ **Resolved per access, not once.** Two things forced it. The Hyperdrive binding
 * exists only inside a request, while this module is imported long before one —
 * `src/auth.ts` builds the Auth.js adapter at module load — so an instance created
 * then would keep the direct connection string for the life of the isolate, and every
 * query on Workers would go the way that does not work. And a connection built at
 * module load also meant the production build opened one while collecting page data,
 * against whatever DATABASE_URL the build machine happened to have.
 *
 * ⚠️ The proxy forwards `getPrototypeOf` as well as `get`, because the Auth.js adapter
 * identifies the dialect with `instanceof` and answered "Unsupported database type
 * (object)" against a bare proxy — a build failure with nothing in it about proxies.
 */
const platformHandler: ProxyHandler<AppDatabase<typeof platformSchema>> = {
  get(_target, property) {
    const db = instanceFor(process.env.DATABASE_URL ?? "", platformSchema, "HYPERDRIVE_PLATFORM") as object;
    const value = Reflect.get(db, property);
    return typeof value === "function" ? value.bind(db) : value;
  },
  has(_target, property) {
    return Reflect.has(
      instanceFor(process.env.DATABASE_URL ?? "", platformSchema, "HYPERDRIVE_PLATFORM") as object,
      property,
    );
  },
  getPrototypeOf() {
    return Reflect.getPrototypeOf(
      instanceFor(process.env.DATABASE_URL ?? "", platformSchema, "HYPERDRIVE_PLATFORM") as object,
    );
  },
  ownKeys() {
    return Reflect.ownKeys(
      instanceFor(process.env.DATABASE_URL ?? "", platformSchema, "HYPERDRIVE_PLATFORM") as object,
    );
  },
  getOwnPropertyDescriptor(_target, property) {
    const descriptor = Reflect.getOwnPropertyDescriptor(
      instanceFor(process.env.DATABASE_URL ?? "", platformSchema, "HYPERDRIVE_PLATFORM") as object,
      property,
    );
    // A proxy may only report a property as non-configurable if its target has it.
    return descriptor && { ...descriptor, configurable: true };
  },
};

export const platformDb = new Proxy({} as AppDatabase<typeof platformSchema>, platformHandler);

// ─── Tenant DB factory ────────────────────────────────────────────────────────
// Cache is keyed by tenantId; each entry is a long-lived drizzle instance. Neon HTTP
// is stateless and safe to reuse across requests; the pooled driver is cached for the
// stronger reason that a pool per request would open a connection per request.
// Uses tenantSchema (no platform-only tables) so queries against tenant DBs
// cannot accidentally reference tenants/billingPlans/etc.
export function createTenantDb(tenantId: string, decryptedUrl: string) {
  // Keyed by the connection string it resolves to, so a workspace reached through
  // Hyperdrive and the same workspace reached directly are not the same entry.
  return instanceFor(decryptedUrl, tenantSchema);
}

export function invalidateTenantDbCache(tenantId: string): void {
  // The cache is keyed by connection string now. A workspace whose database moves gets
  // a different one; nothing to forget here, and nothing that grows without bound.
  void tenantId;
}
