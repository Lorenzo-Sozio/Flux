-- The address a person puts in Bcc from their own mailbox so the email is filed on the
-- records it was sent to (V2.8, §9 step 2), and the message id that keeps a redelivered
-- webhook from filing it twice.
--
-- Additive and re-runnable, like every tenant migration.
CREATE TABLE IF NOT EXISTS "mail_archive_address" (
	"user_id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mail_archive_address_token_idx" ON "mail_archive_address" USING btree ("token");--> statement-breakpoint
ALTER TABLE "activity" ADD COLUMN IF NOT EXISTS "message_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "activity_message_record_idx" ON "activity" USING btree ("message_id", coalesce("contact_id", ''), coalesce("lead_id", '')) WHERE "message_id" IS NOT NULL;
