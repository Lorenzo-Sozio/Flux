/**
 * Every tenant migration, applied to a real Postgres — and applied twice.
 *
 * ⚠️⚠️ CLAUDE.md requires every tenant migration to be re-runnable: the Neon HTTP
 * driver holds no transaction across statements, so a migration that stops halfway
 * leaves its first statements applied, records nothing, and runs again from the
 * top on the next attempt. Until this test that rule was only written down. A
 * `CREATE TABLE` without `IF NOT EXISTS` passes every other test and takes a
 * workspace's migrations down the first time a deploy is interrupted.
 *
 * PGlite is Postgres itself compiled to WebAssembly, so these are the real parser,
 * the real catalog and the real errors — nothing is mocked.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it } from "vitest";

import { tenantMigrations } from "./migrations-tenant.generated";

/**
 * Written before the rule was: drizzle-kit output with bare `ADD COLUMN`. Already
 * applied to every workspace, so the only exposure is a new workspace whose
 * provisioning is interrupted inside it. Named here so that fixing it, or a new
 * migration breaking the rule, both turn this test red.
 */
const KNOWN_NOT_RERUNNABLE = ["0002_odd_ulik"];

describe("tenant migrations on a real Postgres", () => {
  it("⚠️⚠️ each one can be interrupted and run again from the top", async () => {
    const db = drizzle(new PGlite());
    const notRerunnable: string[] = [];
    for (const migration of tenantMigrations) {
      for (const statement of migration.sql) {
        try {
          await db.execute(sql.raw(statement));
        } catch (err) {
          const cause = (err as { cause?: { message?: string } }).cause?.message ?? String(err);
          throw new Error(`${migration.tag} does not apply: ${cause}
${statement.slice(0, 200)}`);
        }
      }
      let failed = false;
      for (const statement of migration.sql) {
        try {
          await db.execute(sql.raw(statement));
        } catch {
          failed = true;
        }
      }
      if (failed) notRerunnable.push(migration.tag);
    }
    expect(tenantMigrations.length).toBeGreaterThan(20);
    expect(notRerunnable, "a migration that cannot be run twice").toEqual(KNOWN_NOT_RERUNNABLE);
  }, 180_000);
});
