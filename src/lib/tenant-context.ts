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

import { createTenantDb, platformDb } from "@/db";

import { getTenantById } from "./get-tenant";
import { decryptDbUrl } from "./tenant-db";

export const getDb = cache(async () => {
  let tenantId: string | null = null;

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

  return createTenantDb(tenant.id, decryptDbUrl(tenant.dbUrl));
});

/**
 * Returns the active tenantId from the x-tenant-id header injected by middleware.
 * Returns null when called outside a tenant request (e.g., admin panel, cron jobs).
 */
export const getCurrentTenantId = cache(async (): Promise<string | null> => {
  try {
    const h = await headers();
    return h.get("x-tenant-id") ?? null;
  } catch {
    return null;
  }
});
