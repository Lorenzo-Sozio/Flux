/**
 * Per-request tenant DB accessor for Server Components and Server Actions.
 * Server-only — uses React cache() for request-scoped deduplication.
 *
 * Usage (in any server component or action):
 *   const db = await getDb();
 *   const contacts = await db.query.contacts.findMany(...);
 *
 * On the main domain (no subdomain) returns platformDb so existing actions
 * keep working during the Block 2 migration.
 */
import { cache } from "react";
import { headers } from "next/headers";
import { platformDb, createTenantDb } from "@/db";
import { getTenantBySubdomain } from "./get-tenant";
import { decryptDbUrl } from "./tenant-db";
import { extractSubdomainFromHost } from "./subdomain";

export { extractSubdomainFromHost };

export const getDb = cache(async () => {
  let host = "";
  
  try {
    // Try to get headers from request context
    const h = await headers();
    host = h.get("host") ?? "";
  } catch (err) {
    // Outside request context (e.g., instrumentation, cron jobs)
    // Fall back to platformDb
    console.warn(
      "[getDb] Called outside request context, using platformDb. " +
      "(This is normal during server startup or background jobs.)"
    );
    return platformDb;
  }

  const subdomain = extractSubdomainFromHost(host);

  if (!subdomain) return platformDb;

  const tenant = await getTenantBySubdomain(subdomain);
  if (!tenant) {
    const err = new Error(`Tenant not found: ${subdomain}`);
    (err as NodeJS.ErrnoException).code = "TENANT_NOT_FOUND";
    throw err;
  }

  return createTenantDb(tenant.id, decryptDbUrl(tenant.dbUrl));
});

/**
 * Returns the current subdomain (if any) derived from request headers.
 * Useful for server actions that need to know which tenant they're serving.
 * 
 * Returns null if called outside request context (e.g., during server startup).
 */
export const getCurrentSubdomain = cache(async (): Promise<string | null> => {
  try {
    const h = await headers();
    return extractSubdomainFromHost(h.get("host") ?? "");
  } catch (err) {
    // Outside request context
    return null;
  }
});
