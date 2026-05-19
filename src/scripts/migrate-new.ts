/**
 * Applies only the new migration 0005 directly against the DB.
 * Run with: npx tsx src/scripts/migrate-new.ts
 */
import { neon } from "@neondatabase/serverless";
import * as dotenv from "dotenv";

dotenv.config();

const sql = neon(process.env.DATABASE_URL!);

async function run() {
  console.log("Applying migration 0005...");

  await sql`CREATE TABLE IF NOT EXISTS "password_reset_token" (
    "identifier" text NOT NULL,
    "token" text NOT NULL,
    "expires" timestamp NOT NULL,
    CONSTRAINT "password_reset_token_identifier_token_pk" PRIMARY KEY("identifier","token")
  )`;

  await sql`CREATE TABLE IF NOT EXISTS "user_invitation" (
    "id" text PRIMARY KEY NOT NULL,
    "email" text NOT NULL,
    "token" text NOT NULL UNIQUE,
    "role" text NOT NULL DEFAULT 'user',
    "invited_by_id" text REFERENCES "user"("id") ON DELETE SET NULL,
    "expires_at" timestamp NOT NULL,
    "accepted_at" timestamp,
    "created_at" timestamp NOT NULL DEFAULT now()
  )`;

  await sql`CREATE TABLE IF NOT EXISTS "notification" (
    "id" text PRIMARY KEY NOT NULL,
    "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "type" text NOT NULL,
    "title" text NOT NULL,
    "message" text,
    "link" text,
    "is_read" boolean NOT NULL DEFAULT false,
    "created_at" timestamp NOT NULL DEFAULT now()
  )`;

  await sql`CREATE TABLE IF NOT EXISTS "custom_field_definition" (
    "id" text PRIMARY KEY NOT NULL,
    "name" text NOT NULL,
    "slug" text NOT NULL,
    "entity_type" text NOT NULL,
    "field_type" text NOT NULL,
    "options" text,
    "is_required" boolean NOT NULL DEFAULT false,
    "order" integer NOT NULL DEFAULT 0,
    "owner_id" text REFERENCES "user"("id") ON DELETE SET NULL,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp NOT NULL DEFAULT now()
  )`;

  await sql`CREATE TABLE IF NOT EXISTS "custom_field_value" (
    "id" text PRIMARY KEY NOT NULL,
    "field_id" text NOT NULL REFERENCES "custom_field_definition"("id") ON DELETE CASCADE,
    "entity_type" text NOT NULL,
    "entity_id" text NOT NULL,
    "value" text,
    "updated_at" timestamp NOT NULL DEFAULT now()
  )`;

  await sql`CREATE TABLE IF NOT EXISTS "document" (
    "id" text PRIMARY KEY NOT NULL,
    "name" text NOT NULL,
    "url" text NOT NULL,
    "mime_type" text,
    "size" integer,
    "version" integer NOT NULL DEFAULT 1,
    "entity_type" text,
    "entity_id" text,
    "owner_id" text REFERENCES "user"("id") ON DELETE SET NULL,
    "created_at" timestamp NOT NULL DEFAULT now()
  )`;

  await sql`CREATE TABLE IF NOT EXISTS "webhook" (
    "id" text PRIMARY KEY NOT NULL,
    "name" text NOT NULL,
    "url" text NOT NULL,
    "events" text[] NOT NULL,
    "secret" text,
    "is_active" boolean NOT NULL DEFAULT true,
    "owner_id" text REFERENCES "user"("id") ON DELETE SET NULL,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp NOT NULL DEFAULT now()
  )`;

  await sql`CREATE TABLE IF NOT EXISTS "webhook_log" (
    "id" text PRIMARY KEY NOT NULL,
    "webhook_id" text NOT NULL REFERENCES "webhook"("id") ON DELETE CASCADE,
    "event" text NOT NULL,
    "payload" text,
    "status_code" integer,
    "response" text,
    "sent_at" timestamp NOT NULL DEFAULT now(),
    "success" boolean NOT NULL DEFAULT false
  )`;

  await sql`CREATE INDEX IF NOT EXISTS "notification_user_id_idx" ON "notification"("user_id")`;
  await sql`CREATE INDEX IF NOT EXISTS "custom_field_value_entity_idx" ON "custom_field_value"("entity_type", "entity_id")`;
  await sql`CREATE INDEX IF NOT EXISTS "document_entity_idx" ON "document"("entity_type", "entity_id")`;

  // --- Custom filters (were in schema but never migrated) ---
  await sql`CREATE TABLE IF NOT EXISTS "custom_filter" (
    "id" text PRIMARY KEY NOT NULL,
    "name" text NOT NULL,
    "description" text,
    "entity_type" text NOT NULL,
    "owner_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "criteria" text NOT NULL,
    "is_public" boolean DEFAULT false,
    "is_pinned" boolean DEFAULT false,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp NOT NULL DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS "custom_filter_tag" (
    "id" text PRIMARY KEY NOT NULL,
    "filter_id" text NOT NULL REFERENCES "custom_filter"("id") ON DELETE CASCADE,
    "tag" text NOT NULL
  )`;
  await sql`CREATE TABLE IF NOT EXISTS "filter_preset" (
    "id" text PRIMARY KEY NOT NULL,
    "name" text NOT NULL,
    "description" text,
    "entity_type" text NOT NULL,
    "default_criteria" text NOT NULL,
    "is_system" boolean DEFAULT false,
    "created_at" timestamp NOT NULL DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS "custom_filter_owner_entity_idx" ON "custom_filter"("owner_id", "entity_type")`;

  // --- Add missing columns to existing tables (idempotent) ---
  await sql`ALTER TABLE "deal" ADD COLUMN IF NOT EXISTS "probability" integer DEFAULT 0`;
  await sql`ALTER TABLE "deal" ADD COLUMN IF NOT EXISTS "currency" text NOT NULL DEFAULT 'EUR'`;
  await sql`ALTER TABLE "deal" ADD COLUMN IF NOT EXISTS "notes" text`;
  await sql`ALTER TABLE "pipeline_stage" ADD COLUMN IF NOT EXISTS "default_probability" integer DEFAULT 0`;

  console.log("Migration 0005 applied successfully!");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
