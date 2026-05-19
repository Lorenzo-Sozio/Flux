import { neon } from "@neondatabase/serverless";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { drizzle } from "drizzle-orm/neon-http";

import * as platformSchema from "./schema";
import * as tenantSchema from "./schema-tenant";

// Platform DB — tenant registry, lives on DATABASE_URL
const platformSql = neon(process.env.DATABASE_URL!);
export const platformDb = drizzle(platformSql, { schema: platformSchema });

// ─── Tenant DB factory ────────────────────────────────────────────────────────
// Cache is keyed by tenantId; each entry is a long-lived drizzle instance
// because Neon HTTP is stateless and safe to reuse across requests.
// Uses tenantSchema (no platform-only tables) so queries against tenant DBs
// cannot accidentally reference tenants/billingPlans/etc.
const tenantDbCache = new Map<string, NeonHttpDatabase<typeof tenantSchema>>();

export function createTenantDb(tenantId: string, decryptedUrl: string) {
  let tenantDb = tenantDbCache.get(tenantId);
  if (!tenantDb) {
    const sql = neon(decryptedUrl);
    tenantDb = drizzle(sql, { schema: tenantSchema });
    tenantDbCache.set(tenantId, tenantDb);
  }
  return tenantDb;
}

export function invalidateTenantDbCache(tenantId: string): void {
  tenantDbCache.delete(tenantId);
}
