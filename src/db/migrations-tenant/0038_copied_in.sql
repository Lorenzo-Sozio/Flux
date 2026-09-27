-- Copies on a queued email: an automation that sends to the customer and copies the owner
-- goes through the workspace's queue now (V2.7, §8.3), and the queue had only a "to".
--
-- Additive and re-runnable, like every tenant migration.
ALTER TABLE "email_job" ADD COLUMN IF NOT EXISTS "cc" text;--> statement-breakpoint
ALTER TABLE "email_job" ADD COLUMN IF NOT EXISTS "bcc" text;
