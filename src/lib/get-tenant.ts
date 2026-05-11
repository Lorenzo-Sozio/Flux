/**
 * Lookup a tenant by subdomain from the platform DB.
 * Server-only. Results are cached in-memory with a 5-minute TTL to avoid
 * hitting the platform DB on every request.
 *
 * Call invalidateTenantCache(subdomain) after creating or updating a tenant
 * so the new record is picked up immediately.
 */
import { eq } from "drizzle-orm";
import { platformDb } from "@/db";
import { tenants } from "@/db/schema";

export type Tenant = typeof tenants.$inferSelect;

const TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  tenant: Tenant | null;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export async function getTenantBySubdomain(
  subdomain: string,
): Promise<Tenant | null> {
  const now = Date.now();
  const hit = cache.get(subdomain);
  if (hit && now < hit.expiresAt) return hit.tenant;

  const tenant = await platformDb.query.tenants.findFirst({
    where: eq(tenants.subdomain, subdomain),
  });

  cache.set(subdomain, { tenant: tenant ?? null, expiresAt: now + TTL_MS });
  return tenant ?? null;
}

export function invalidateTenantCache(subdomain: string): void {
  cache.delete(subdomain);
}
