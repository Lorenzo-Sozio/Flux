/**
 * A workspace that ran 0029 before 0030 existed.
 *
 * 0029 was once rewritten in place to carry the repeating and all-day columns.
 * Every workspace that had already applied it kept its recorded timestamp, the
 * migrator applies only what is newer than that, and so those columns were never
 * created there: every screen reading appointments, the home page first, failed
 * with "column does not exist".
 *
 * The fix is 0030, a newer migration. This builds exactly that database — 0029
 * recorded, the new columns absent — and checks that migrating it creates them.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { expect, it } from "vitest";

import { applyTenantMigrations } from "./migrate-tenant";

const NEW_COLUMNS = [
  "reminder_sent_for",
  "all_day",
  "recurrence_rule",
  "recurrence_exceptions",
  "recurrence_parent_id",
];

async function appointmentColumns(db: ReturnType<typeof drizzle>) {
  const rows = await db.execute<{ column_name: string }>(
    sql`select column_name from information_schema.columns where table_name = 'appointment'`,
  );
  return rows.rows.map((r) => r.column_name);
}

it("⚠️ adds the new appointment columns to a workspace that had already run 0029", async () => {
  const db = drizzle(new PGlite());
  await applyTenantMigrations(db as never);

  // Back to the state of a workspace migrated with the first 0029: the columns
  // are not there and 0030 is not recorded.
  for (const column of NEW_COLUMNS) {
    await db.execute(sql.raw(`alter table "appointment" drop column "${column}"`));
  }
  // Everything after 0029 unrecorded, not just 0030: the migrator applies what is newer
  // than the newest row, so leaving a later migration recorded would model a workspace
  // that cannot exist — and skip 0030 for the wrong reason.
  await db.execute(sql`delete from drizzle.__drizzle_migrations where created_at >= 1790200000000`);
  expect(await appointmentColumns(db)).not.toContain("all_day");

  await applyTenantMigrations(db as never);

  const columns = await appointmentColumns(db);
  for (const column of NEW_COLUMNS) expect(columns).toContain(column);
}, 120_000);
