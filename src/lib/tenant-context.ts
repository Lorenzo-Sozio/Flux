/**
 * Per-request tenant DB accessor for Server Components and Server Actions.
 * Server-only — uses React cache() for request-scoped deduplication.
 *
 * Usage (in any server component or action):
 *   const db = await getDb();
 *   const contacts = await db.query.contacts.findMany(...);
 *
 * Tenant resolution: reads the x-tenant-id header injected by the middleware
 * after verifying the user's JWT. The client can never forge this header.
 */
import { cache } from "react";

import { headers } from "next/headers";

import { AsyncLocalStorage } from "node:async_hooks";

import { createTenantDb, platformDb } from "@/db";
import { ensureTenantMigrated } from "@/db/auto-migrate";

import { getTenantById } from "./get-tenant";
import { decryptDbUrl } from "./tenant-db";

/**
 * An explicit tenant for work that has no request to read one from.
 *
 * Background jobs process every workspace in turn inside a single HTTP request,
 * so a header — or React's per-request `cache()` — cannot express "this tenant,
 * for the duration of this callback". Without it every cron route resolved to no
 * tenant at all and threw before doing any work (audit rilievo B-02).
 *
 * Scoped rather than global on purpose: two workspaces processed concurrently
 * must not be able to observe each other's context.
 */
const tenantOverride = new AsyncLocalStorage<string>();

/**
 * Runs `fn` with `tenantId` as the active workspace.
 *
 * Everything called inside — including server actions written for the dashboard
 * — resolves `getDb()` to that workspace, which is what lets a job reuse the
 * same code paths the UI uses instead of duplicating them.
 */
export function runWithTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return tenantOverride.run(tenantId, fn);
}

/** The workspace set by `runWithTenant`, if any. */
export function getOverriddenTenantId(): string | null {
  return tenantOverride.getStore() ?? null;
}

/**
 * NOT wrapped in `cache()`: an override changes within a single request as a job
 * moves from one workspace to the next, and a memoised handle would hand the
 * second workspace the first one's database.
 */
async function resolveDb() {
  let tenantId: string | null = getOverriddenTenantId();

  if (tenantId) {
    const tenant = await getTenantById(tenantId);
    if (!tenant) {
      const err = new Error(`Tenant not found: ${tenantId}`);
      (err as NodeJS.ErrnoException).code = "TENANT_NOT_FOUND";
      throw err;
    }
    return openTenant(tenant.id, decryptDbUrl(tenant.dbUrl));
  }

  try {
    const h = await headers();
    tenantId = h.get("x-tenant-id") ?? null;
  } catch {
    // Outside request context (e.g., instrumentation, cron jobs)
    console.warn(
      "[getDb] Called outside request context, using platformDb. " +
        "(This is normal during server startup or background jobs.)",
    );
    return platformDb;
  }

  if (!tenantId) {
    // FAIL LOUD: every route that calls getDb() must have a tenant context injected
    // by middleware. Silently falling back to platformDb would route tenant-scoped
    // queries to the wrong database without any indication to the caller.
    throw new Error(
      "[getDb] No x-tenant-id header in request. " +
        "All dashboard routes require a tenant context — check middleware configuration.",
    );
  }

  const tenant = await getTenantById(tenantId);
  if (!tenant) {
    const err = new Error(`Tenant not found: ${tenantId}`);
    (err as NodeJS.ErrnoException).code = "TENANT_NOT_FOUND";
    throw err;
  }

  return openTenant(tenant.id, decryptDbUrl(tenant.dbUrl));
}

/**
 * The handle for one workspace, up to date with the code that is about to use it.
 *
 * Every customer has their own database, so a schema change lands once per
 * customer and used to wait for somebody to press a button in the admin panel —
 * after the deploy. In between, the code knew about columns the database had not
 * got, and a single missing column takes down a whole screen because a relational
 * read names every column the schema declares. That window broke production three
 * times before it was closed here.
 *
 * The check costs one SELECT per workspace per process, and only the first
 * request pays it: `ensureTenantMigrated` remembers the attempt. It never throws,
 * so a workspace that cannot be migrated still serves its pages.
 */
async function openTenant(tenantId: string, url: string) {
  const db = createTenantDb(tenantId, url);
  await ensureTenantMigrated(tenantId, db);
  return db;
}

/**
 * The tenant database for the current request.
 *
 * Memoised per request when the tenant comes from the header, so a page with a
 * dozen queries opens one handle. When a job has set an explicit tenant the
 * memoisation is bypassed, because the answer changes as the job advances.
 */
const getDbCached = cache(resolveDb);

export async function getDb() {
  return getOverriddenTenantId() ? resolveDb() : getDbCached();
}

/**
 * Returns the active tenantId from the x-tenant-id header injected by middleware.
 * Returns null when called outside a tenant request (e.g., admin panel, cron jobs).
 */
export async function getCurrentTenantId(): Promise<string | null> {
  const overridden = getOverriddenTenantId();
  if (overridden) return overridden;

  try {
    const h = await headers();
    return h.get("x-tenant-id") ?? null;
  } catch {
    return null;
  }
}
