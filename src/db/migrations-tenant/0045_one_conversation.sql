-- Sequences that are more than a list of emails (V3.9, §8.4): a step can be a task for the
-- salesperson, the waits can count working days, sends can keep to a window of hours, and
-- a follow-up can go out as a reply in the first email's thread.
--
-- Additive and re-runnable, like every tenant migration.
ALTER TABLE "email_sequence_step" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'email' NOT NULL;--> statement-breakpoint
ALTER TABLE "email_sequence_step" ADD COLUMN IF NOT EXISTS "task_type" text;--> statement-breakpoint
ALTER TABLE "email_sequence_step" ADD COLUMN IF NOT EXISTS "reply_in_thread" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "email_sequence" ADD COLUMN IF NOT EXISTS "business_days" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "email_sequence" ADD COLUMN IF NOT EXISTS "send_from" text;--> statement-breakpoint
ALTER TABLE "email_sequence" ADD COLUMN IF NOT EXISTS "send_until" text;--> statement-breakpoint
ALTER TABLE "email_sequence_enrollment" ADD COLUMN IF NOT EXISTS "thread_message_id" text;--> statement-breakpoint
ALTER TABLE "email_sequence_enrollment" ADD COLUMN IF NOT EXISTS "thread_subject" text;--> statement-breakpoint
ALTER TABLE "email_job" ADD COLUMN IF NOT EXISTS "message_header_id" text;--> statement-breakpoint
ALTER TABLE "email_job" ADD COLUMN IF NOT EXISTS "in_reply_to" text;
