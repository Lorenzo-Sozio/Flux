#!/usr/bin/env npx tsx
/**
 * Applies the Drizzle schema to every tenant database.
 * Safe to run multiple times — pushSchema only applies missing changes.
 *
 * Usage:
 *   npx tsx scripts/migrate-all-tenants.ts              # all tenants
 *   npx tsx scripts/migrate-all-tenants.ts acme other   # specific tenants
 *   npx tsx scripts/migrate-all-tenants.ts --dry-run    # preview only
 *
 * Required env vars (loaded from .env automatically):
 *   DATABASE_URL             — platform DB (tenant registry)
 *   PLATFORM_ENCRYPTION_KEY  — 64-char hex key for decrypting tenant DB URLs
 */
import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { pushSchema } from "drizzle-kit/api";
import { tenants } from "../src/db/schema";
import { decryptDbUrl } from "../src/lib/tenant-db";
import * as tenantSchema from "../src/db/schema-tenant";

const isDryRun = process.argv.includes("--dry-run");
const filterSubdomains = process.argv.slice(2).filter((a) => !a.startsWith("-"));

async function migrateTenant(subdomain: string, dbUrl: string): Promise<{ warnings: string[] }> {
  const sql = neon(dbUrl);
  const db = drizzle(sql);
  const { hasDataLoss, warnings, apply } = await pushSchema(tenantSchema, db);

  if (warnings.length > 0) {
    console.warn(`  ⚠  Warnings for ${subdomain}:`, warnings);
  }

  if (hasDataLoss) {
    throw new Error("Schema push would cause data loss — skipped. Review manually.");
  }

  if (!isDryRun) {
    await apply();
  }

  return { warnings };
}

async function main() {
  const platformUrl = process.env.DATABASE_URL;
  if (!platformUrl) {
    console.error("ERROR: DATABASE_URL is not set.");
    process.exit(1);
  }

  if (!process.env.PLATFORM_ENCRYPTION_KEY) {
    console.error("ERROR: PLATFORM_ENCRYPTION_KEY is not set.");
    process.exit(1);
  }

  if (isDryRun) {
    console.log("DRY RUN — no changes will be applied.\n");
  }

  const platformSql = neon(platformUrl);
  const platformDb = drizzle(platformSql, { schema: { tenants } });

  const allTenants = await platformDb.select({
    id: tenants.id,
    subdomain: tenants.subdomain,
    dbUrl: tenants.dbUrl,
  }).from(tenants).orderBy(tenants.createdAt);

  const targets = filterSubdomains.length > 0
    ? allTenants.filter((t) => filterSubdomains.includes(t.subdomain))
    : allTenants;

  if (targets.length === 0) {
    console.log("No tenants found" + (filterSubdomains.length > 0 ? ` matching: ${filterSubdomains.join(", ")}` : "") + ".");
    process.exit(0);
  }

  console.log(`Migrating ${targets.length} tenant(s)...\n`);

  let passed = 0;
  let failed = 0;

  for (const tenant of targets) {
    process.stdout.write(`  ${tenant.subdomain} ... `);
    try {
      const decrypted = decryptDbUrl(tenant.dbUrl);
      const { warnings } = await migrateTenant(tenant.subdomain, decrypted);
      console.log(isDryRun ? "ok (dry run)" : "✓ done" + (warnings.length ? ` (${warnings.length} warning(s))` : ""));
      passed++;
    } catch (err) {
      console.log(`✗ FAILED: ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  }

  console.log(`\n${passed} succeeded, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
