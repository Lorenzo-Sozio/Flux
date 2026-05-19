/**
 * Run: npx tsx src/scripts/migrate-email.ts
 * Adds email_settings, email_job, email_suppression tables
 * and extends campaign_log with tracking timestamp columns.
 */
import { neon } from "@neondatabase/serverless";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local" }); // overrides if exists

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  console.log("Running email infrastructure migration…");

  await sql`
    ALTER TABLE "campaign_log"
      ADD COLUMN IF NOT EXISTS "opened_at"    timestamp,
      ADD COLUMN IF NOT EXISTS "clicked_at"   timestamp,
      ADD COLUMN IF NOT EXISTS "error_message" text,
      ADD COLUMN IF NOT EXISTS "message_id"   text
  `;
  console.log("✓ campaign_log columns added");

  await sql`
    CREATE TABLE IF NOT EXISTS "email_settings" (
      "id"            text PRIMARY KEY DEFAULT gen_random_uuid(),
      "provider"      text NOT NULL DEFAULT 'resend',
      "resend_api_key" text,
      "smtp_host"     text,
      "smtp_port"     integer DEFAULT 587,
      "smtp_user"     text,
      "smtp_password" text,
      "smtp_secure"   boolean DEFAULT false,
      "from_email"    text NOT NULL DEFAULT 'noreply@yourdomain.com',
      "from_name"     text NOT NULL DEFAULT 'CRM',
      "created_at"    timestamp DEFAULT now() NOT NULL,
      "updated_at"    timestamp DEFAULT now() NOT NULL
    )
  `;
  console.log("✓ email_settings table created");

  await sql`
    CREATE TABLE IF NOT EXISTS "email_job" (
      "id"               text PRIMARY KEY DEFAULT gen_random_uuid(),
      "campaign_id"      text REFERENCES "marketing_campaign"("id") ON DELETE CASCADE,
      "campaign_log_id"  text REFERENCES "campaign_log"("id") ON DELETE CASCADE,
      "to_email"         text NOT NULL,
      "subject"          text NOT NULL,
      "html_body"        text NOT NULL,
      "status"           text NOT NULL DEFAULT 'pending',
      "attempts"         integer NOT NULL DEFAULT 0,
      "max_attempts"     integer NOT NULL DEFAULT 3,
      "last_error"       text,
      "scheduled_at"     timestamp DEFAULT now(),
      "processed_at"     timestamp,
      "created_at"       timestamp DEFAULT now() NOT NULL
    )
  `;
  console.log("✓ email_job table created");

  await sql`
    CREATE INDEX IF NOT EXISTS "email_job_status_scheduled_idx"
      ON "email_job" ("status", "scheduled_at")
      WHERE "status" = 'pending'
  `;
  console.log("✓ email_job index created");

  await sql`
    CREATE TABLE IF NOT EXISTS "email_suppression" (
      "id"          text PRIMARY KEY DEFAULT gen_random_uuid(),
      "email"       text NOT NULL UNIQUE,
      "reason"      text NOT NULL DEFAULT 'unsubscribe',
      "campaign_id" text,
      "created_at"  timestamp DEFAULT now() NOT NULL
    )
  `;
  console.log("✓ email_suppression table created");

  console.log("\n✅ Migration complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
