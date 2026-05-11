import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

// Platform DB — tenant registry, lives on DATABASE_URL
const platformSql = neon(process.env.DATABASE_URL!);
export const platformDb = drizzle(platformSql, { schema });

// ─── Tenant DB factory ────────────────────────────────────────────────────────
// Cache is keyed by tenantId; each entry is a long-lived drizzle instance
// because Neon HTTP is stateless and safe to reuse across requests.
const tenantDbCache = new Map<string, NeonHttpDatabase<typeof schema>>();

export function createTenantDb(tenantId: string, decryptedUrl: string) {
  let tenantDb = tenantDbCache.get(tenantId);
  if (!tenantDb) {
    const sql = neon(decryptedUrl);
    tenantDb = drizzle(sql, { schema });
    tenantDbCache.set(tenantId, tenantDb);
  }
  return tenantDb;
}

export function invalidateTenantDbCache(tenantId: string): void {
  tenantDbCache.delete(tenantId);
}
