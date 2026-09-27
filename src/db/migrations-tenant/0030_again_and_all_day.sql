-- Repeating and all-day appointments, and a reminder memory that understands both.
--
-- ⚠️ A separate migration, not an edit of 0029. A workspace that had already run
-- 0029 recorded its timestamp, and the migrator applies only what is newer than
-- the newest recorded: rewriting 0029 in place meant these columns were never
-- created there, and every screen reading appointments — the home page among
-- them — failed on "column does not exist".
--
-- `reminder_sent_for` replaces 0029's `reminder_sent_at`, which is left in place
-- and unused: tenant migrations are additive, never destructive.
--
-- Additive and re-runnable, like every tenant migration.
ALTER TABLE "appointment" ADD COLUMN IF NOT EXISTS "reminder_sent_for" timestamp;
--> statement-breakpoint
ALTER TABLE "appointment" ADD COLUMN IF NOT EXISTS "all_day" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "appointment" ADD COLUMN IF NOT EXISTS "recurrence_rule" text;
--> statement-breakpoint
ALTER TABLE "appointment" ADD COLUMN IF NOT EXISTS "recurrence_exceptions" text[];
--> statement-breakpoint
ALTER TABLE "appointment" ADD COLUMN IF NOT EXISTS "recurrence_parent_id" text;
