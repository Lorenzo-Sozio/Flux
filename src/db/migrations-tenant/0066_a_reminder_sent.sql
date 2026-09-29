-- The last payment reminder sent for an overdue invoice, and how many: the page says when the
-- customer was last reminded, and a second click within the hour sends nothing.
--
-- ⚠️ Its own migration, not two more lines in 0065: 0065 had already run — a dev server on the
-- shared database applies a migration the moment it is embedded — and a migration that is
-- recorded is never read again. The columns were missing and the invoice page failed.
--
-- Additive and re-runnable, like every tenant migration.
ALTER TABLE "invoice" ADD COLUMN IF NOT EXISTS "reminded_at" timestamp;
--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN IF NOT EXISTS "reminder_count" integer DEFAULT 0 NOT NULL;
