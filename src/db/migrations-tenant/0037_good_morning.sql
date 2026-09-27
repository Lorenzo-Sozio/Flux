-- One morning email instead of one email per task.
--
-- The task reminder sent an email for every task due today, with no summary and no way to
-- turn it off. It is replaced by a digest built once a day; a person can switch it off, it
-- is written in the language they last used the product in, and it is sent once a day
-- however many times the job runs.
--
-- Additive and re-runnable, like every tenant migration.
ALTER TABLE "notification_preference" ADD COLUMN IF NOT EXISTS "digest_email" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_preference" ADD COLUMN IF NOT EXISTS "locale" text;--> statement-breakpoint
ALTER TABLE "notification_preference" ADD COLUMN IF NOT EXISTS "digest_sent_on" text;
