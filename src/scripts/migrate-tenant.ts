/**
 * Push the full Drizzle schema to a tenant database.
 *
 * Usage:
 *   npx tsx src/scripts/migrate-tenant.ts <postgresql-url>
 *
 * Uses drizzle-kit pushSchema — compares the current schema.ts against the live
 * DB and applies only what is missing.  Safe on fresh DBs and idempotent on
 * existing ones. Aborts if the push would cause data loss.
 */
import { neon } from "@neondatabase/serverless";
import * as dotenv from "dotenv";
import { pushSchema } from "drizzle-kit/api";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "../db/schema-tenant";

dotenv.config();

const dbUrl = process.argv[2];

if (!dbUrl) {
  console.error("Usage: npx tsx src/scripts/migrate-tenant.ts <postgresql-url>");
  process.exit(1);
}

const redacted = dbUrl.replace(/:([^@]+)@/, ":***@");
const sql = neon(dbUrl);
const db = drizzle(sql);

async function run() {
  console.log(`Pushing schema to: ${redacted}`);

  const { hasDataLoss, warnings, statementsToExecute, apply } = await pushSchema(schema, db);

  if (warnings.length > 0) {
    console.warn("Warnings:", warnings);
  }

  if (hasDataLoss) {
    console.error("Schema push would cause data loss — aborting. Review the DB manually.");
    process.exit(1);
  }

  console.log(`${statementsToExecute.length} statement(s) to apply.`);
  await apply();
  console.log("Done — schema is up to date.");
}

run().catch((e) => {
  console.error("Push failed:", e.message ?? e);
  process.exit(1);
});
