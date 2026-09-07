-- The same request twice, and only one import.
--
-- The bulk import routes already tell a caller everything: how many rows were
-- created, updated and skipped, and the field-level reason for each one that was
-- rejected. All of it depends on the response arriving. When it does not — a
-- timeout, a dropped connection — the caller knows nothing at all, and their only
-- move is to send the batch again. Contacts and leads deduplicate on email alone,
-- email is optional for both, and the activity routes deduplicate on nothing, so
-- that second attempt duplicates their data.
--
-- One row per `Idempotency-Key`, holding the answer we gave. A repeat of a
-- finished request gets that answer back, ids and all, instead of importing
-- anything.
--
-- `request_hash` covers the other mistake: the same key sent with a different
-- body. Replying with the first body's result would be worse than duplicating,
-- because it would look like it worked.
--
-- Additive and re-runnable, as every tenant migration has to be: the Neon HTTP
-- driver holds no session, so a migration that fails halfway leaves the
-- statements before it applied and records nothing.
CREATE TABLE IF NOT EXISTS "api_idempotency" (
	"key" text NOT NULL,
	"endpoint" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"response" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	CONSTRAINT "api_idempotency_endpoint_key_pk" PRIMARY KEY("endpoint","key")
);
--> statement-breakpoint
-- ⚠️ The primary key is what makes this work without a transaction. The driver
-- has no session to hold one, so two copies of the same request racing each other
-- cannot be separated by locking. `INSERT … ON CONFLICT DO NOTHING` on this key
-- is the whole mutual exclusion: exactly one of them inserts a row and proceeds,
-- and the other reads what the first is doing.
--
-- Sweeping old rows is a job for later; a key is small and a workspace makes one
-- per import.
CREATE INDEX IF NOT EXISTS "api_idempotency_created_at_idx" ON "api_idempotency" ("created_at");
