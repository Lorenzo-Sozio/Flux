/**
 * Tenant lookup helpers for the platform DB.
 * Server-only. Results are cached in-memory with a 5-minute TTL to avoid
 * hitting the platform DB on every request.
 *
 * Call invalidateTenantCache(id) after creating or updating a tenant
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

const cacheById = new Map<string, CacheEntry>();

/** Primary runtime lookup — used by getDb() via x-tenant-id header. */
export async function getTenantById(id: string): Promise<Tenant | null> {
  const now = Date.now();
  const hit = cacheById.get(id);
  if (hit && now < hit.expiresAt) return hit.tenant;

  const tenant = await platformDb.query.tenants.findFirst({
    where: eq(tenants.id, id),
  });

  cacheById.set(id, { tenant: tenant ?? null, expiresAt: now + TTL_MS });
  return tenant ?? null;
}

/**
 * Runtime lookup for machine-to-machine callers: the tenant is a property of the
 * credential, not a claim of the request.
 *
 * Deliberately NOT cached. The other lookups are keyed by a tenant id the caller already
 * proved it may use; this one is keyed by a secret's fingerprint, and a cache here would
 * keep a revoked key working for up to five minutes — revocation that takes effect
 * "shortly" is not revocation.
 */
export async function getTenantByApiKeyHash(hash: string): Promise<Tenant | null> {
  if (!hash) return null;
  const tenant = await platformDb.query.tenants.findFirst({
    where: eq(tenants.apiKeyHash, hash),
  });
  return tenant ?? null;
}

export function invalidateTenantCache(id: string): void {
  cacheById.delete(id);
}
