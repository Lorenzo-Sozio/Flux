#!/usr/bin/env npx tsx
/**
 * Applies pending Drizzle migrations to every tenant database.
 * Drizzle tracks applied migrations in __drizzle_migrations — safe to run multiple times.
 *
 * Usage:
 *   npx tsx scripts/migrate-all-tenants.ts              # all tenants
 *   npx tsx scripts/migrate-all-tenants.ts acme other   # specific tenants
 *   npx tsx scripts/migrate-all-tenants.ts --dry-run    # preview only (lists tenants, no DB changes)
 *
 * Required env vars (loaded from .env automatically):
 *   DATABASE_URL             — platform DB (tenant registry)
 *   PLATFORM_ENCRYPTION_KEY  — 64-char hex key for decrypting tenant DB URLs
 */
import "dotenv/config";

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import { applyTenantMigrations } from "../src/db/migrate-tenant";
import { tenants } from "../src/db/schema";
import { decryptDbUrl } from "../src/lib/tenant-db";

const isDryRun = process.argv.includes("--dry-run");
const filterSubdomains = process.argv.slice(2).filter((a) => !a.startsWith("-"));

// The same embedded migrations the deployed app applies, so running this script
// and pressing the button in the admin panel can never do different things.
async function migrateTenant(dbUrl: string): Promise<string[]> {
  const sql = neon(dbUrl);
  const db = drizzle(sql);
  const { applied } = await applyTenantMigrations(db);
  return applied;
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

  const allTenants = await platformDb
    .select({
      id: tenants.id,
      subdomain: tenants.subdomain,
      dbUrl: tenants.dbUrl,
    })
    .from(tenants)
    .orderBy(tenants.createdAt);

  const targets =
    filterSubdomains.length > 0 ? allTenants.filter((t) => filterSubdomains.includes(t.subdomain)) : allTenants;

  if (targets.length === 0) {
    console.log(`No tenants found${filterSubdomains.length > 0 ? ` matching: ${filterSubdomains.join(", ")}` : ""}.`);
    process.exit(0);
  }

  console.log(`Migrating ${targets.length} tenant(s)...\n`);

  let passed = 0;
  let failed = 0;

  for (const tenant of targets) {
    process.stdout.write(`  ${tenant.subdomain} ... `);
    try {
      if (isDryRun) {
        console.log("ok (dry run)");
      } else {
        const decrypted = decryptDbUrl(tenant.dbUrl);
        const applied = await migrateTenant(decrypted);
        // "already up to date" and "applied three migrations" both used to print
        // a bare tick, which is the one thing you want to know when you run this.
        console.log(applied.length === 0 ? "✓ already up to date" : `✓ applied ${applied.join(", ")}`);
      }
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
