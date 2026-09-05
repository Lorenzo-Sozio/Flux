/**
 * tenant-resolve.ts — tenant resolution for everything that is NOT a dashboard
 * request.
 *
 * `getDb()` reads the `x-tenant-id` header that the proxy injects after
 * verifying the user's JWT. That covers the authenticated dashboard and its
 * APIs, and nothing else. Every other entry point was calling it anyway and
 * throwing on the missing header (audit rilievi B-01, B-02):
 *
 *   • the public quote page and its accept/decline endpoint
 *   • email open and click tracking — and click tracking is a redirect, so its
 *     failure broke every link in every campaign that had already been sent
 *   • the unsubscribe endpoint
 *   • appointment RSVP
 *   • the Resend delivery webhook, so bounces never reached the suppression list
 *   • inbound email → ticket
 *   • all seven cron jobs
 *
 * These requests carry no session, so the tenant cannot be a claim of the
 * request. It has to be derived from the data the request already identifies —
 * a quote token, a campaign log id, an attendee token — or, for scheduled work,
 * every tenant in turn.
 */
import { asc } from "drizzle-orm";

import { createTenantDb, platformDb } from "@/db";
import { ensureTenantMigrated } from "@/db/auto-migrate";
import { tenants } from "@/db/schema";
import type * as tenantSchema from "@/db/schema-tenant";
import { getTenantById } from "@/lib/get-tenant";
import { decryptDbUrl } from "@/lib/tenant-db";

export type Tenant = typeof tenants.$inferSelect;
export type TenantDb = ReturnType<typeof createTenantDb>;

/** Opens a connection to one tenant's database by id. */
export async function openTenantDb(tenantId: string): Promise<TenantDb | null> {
  const tenant = await getTenantById(tenantId);
  if (!tenant) return null;
  const db = createTenantDb(tenant.id, decryptDbUrl(tenant.dbUrl));
  await ensureTenantMigrated(tenant.id, db);
  return db;
}

/**
 * Every tenant that should be processed by background work, oldest first so the
 * order is stable between runs.
 *
 * Suspended tenants are included on purpose: a suspended workspace still has
 * queued email that must not be silently dropped, and its retention timers keep
 * running. Callers that need to skip them can filter on `status`.
 */
export async function listTenants(): Promise<Tenant[]> {
  return platformDb.select().from(tenants).orderBy(asc(tenants.createdAt));
}

export interface TenantRunResult<T> {
  tenantId: string;
  subdomain: string | null;
  result?: T;
  error?: string;
}

/**
 * Runs `fn` once per tenant, isolating failures.
 *
 * One tenant with an unreachable database, a missing migration or a corrupt
 * encryption key must not stop the job for everyone else — which is exactly
 * what a single shared connection would have done.
 */
export async function forEachTenant<T>(
  fn: (db: TenantDb, tenant: Tenant) => Promise<T>,
  options: { concurrency?: number } = {},
): Promise<TenantRunResult<T>[]> {
  const all = await listTenants();
  const concurrency = Math.max(1, options.concurrency ?? 4);
  const results: TenantRunResult<T>[] = [];

  for (let i = 0; i < all.length; i += concurrency) {
    const slice = all.slice(i, i + concurrency);
    const settled = await Promise.all(
      slice.map(async (tenant): Promise<TenantRunResult<T>> => {
        try {
          const db = createTenantDb(tenant.id, decryptDbUrl(tenant.dbUrl));
          // Scheduled work is the best place for this: a job runs every minute
          // across every workspace, in the background, so a deploy's migrations
          // land on their own within the minute rather than on whichever page
          // request happens to arrive first. It costs one SELECT when there is
          // nothing to do, and never throws.
          await ensureTenantMigrated(tenant.id, db);
          return { tenantId: tenant.id, subdomain: tenant.subdomain, result: await fn(db, tenant) };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[forEachTenant] tenant ${tenant.subdomain ?? tenant.id} failed:`, message);
          return { tenantId: tenant.id, subdomain: tenant.subdomain, error: message };
        }
      }),
    );
    results.push(...settled);
  }

  return results;
}

// ─── Resolving a tenant from an opaque token ──────────────────────────────────

/**
 * Tokens are opaque and do not name their workspace, so resolution means asking
 * each tenant "is this yours?". That is acceptable because the answer is stable
 * for the life of the token and is memoised below — a tracking pixel on a
 * newsletter is fetched thousands of times for one lookup.
 *
 * The cache holds only the mapping token → tenant id. It never holds data, and
 * a miss is cached too (as null) so a scan of every tenant cannot be triggered
 * repeatedly by a bad or expired token.
 */
const lookupCache = new Map<string, { tenantId: string | null; expiresAt: number }>();
const LOOKUP_TTL_MS = 10 * 60 * 1000;
const NEGATIVE_TTL_MS = 60 * 1000;

function cacheGet(key: string): { tenantId: string | null } | undefined {
  const hit = lookupCache.get(key);
  if (!hit) return undefined;
  if (Date.now() > hit.expiresAt) {
    lookupCache.delete(key);
    return undefined;
  }
  return hit;
}

function cacheSet(key: string, tenantId: string | null): void {
  lookupCache.set(key, {
    tenantId,
    expiresAt: Date.now() + (tenantId ? LOOKUP_TTL_MS : NEGATIVE_TTL_MS),
  });
}

export interface ResolvedTenant {
  tenant: Tenant;
  db: TenantDb;
}

/**
 * Finds the tenant whose database answers `probe` with a truthy value, and
 * returns it together with an open connection.
 *
 * `cacheKey` should identify the token being resolved (e.g. `quote:<token>`), so
 * repeat requests for the same token skip the scan entirely.
 */
export async function resolveTenantByProbe(
  cacheKey: string,
  probe: (db: TenantDb, tenant: Tenant) => Promise<boolean>,
): Promise<ResolvedTenant | null> {
  const cached = cacheGet(cacheKey);
  if (cached) {
    if (!cached.tenantId) return null;
    const tenant = await getTenantById(cached.tenantId);
    if (tenant) return { tenant, db: createTenantDb(tenant.id, decryptDbUrl(tenant.dbUrl)) };
    lookupCache.delete(cacheKey);
  }

  for (const tenant of await listTenants()) {
    try {
      const db = createTenantDb(tenant.id, decryptDbUrl(tenant.dbUrl));
      if (await probe(db, tenant)) {
        cacheSet(cacheKey, tenant.id);
        return { tenant, db };
      }
    } catch (err) {
      // A tenant we cannot reach is not a reason to fail the lookup for the one
      // that actually owns the token.
      console.error(`[resolveTenantByProbe] skipping tenant ${tenant.subdomain ?? tenant.id}:`, err);
    }
  }

  cacheSet(cacheKey, null);
  return null;
}

/** Forgets a cached token → tenant mapping. */
export function invalidateTenantLookup(cacheKey: string): void {
  lookupCache.delete(cacheKey);
}

export type { tenantSchema };
