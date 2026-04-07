/**
 * Run: npx tsx src/scripts/migrate-documents.ts
 * Creates the `document` table if it doesn't already exist.
 */
import { neon } from "@neondatabase/serverless";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local" });

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  console.log("Running documents migration…");

  await sql`
    CREATE TABLE IF NOT EXISTS "document" (
      "id"          text PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "name"        text NOT NULL,
      "url"         text NOT NULL,
      "mime_type"   text,
      "size"        integer,
      "version"     integer NOT NULL DEFAULT 1,
      "entity_type" text,
      "entity_id"   text,
      "owner_id"    text REFERENCES "user"("id") ON DELETE SET NULL,
      "created_at"  timestamp NOT NULL DEFAULT now()
    )
  `;
  console.log("✓ document table ready");

  await sql`
    CREATE INDEX IF NOT EXISTS "document_entity_idx"
      ON "document" ("entity_type", "entity_id")
  `;
  console.log("✓ document_entity_idx ready");

  console.log("\n✅ Migration complete.");
}

main().catch((err) => { console.error(err); process.exit(1); });
