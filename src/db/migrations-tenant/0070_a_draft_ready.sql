-- Email templates for one-to-one emails, beside the campaign ones (src/lib/email-templates.ts).
--
-- email_template.kind: "campaign" — built for a marketing campaign, often in the email designer —
--   or "personal" — the text a salesperson starts a one-to-one email from. Every template that
--   exists today was made in Marketing, so every one is a campaign template.
-- email_template.use_count / last_used_at: how often a template was sent from a record, so the
--   ones people actually use come first in the dialog.
--
-- Additive and re-runnable, like every tenant migration.
ALTER TABLE "email_template" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'campaign' NOT NULL;
--> statement-breakpoint
ALTER TABLE "email_template" ADD COLUMN IF NOT EXISTS "use_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "email_template" ADD COLUMN IF NOT EXISTS "last_used_at" timestamp;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_template_kind_idx" ON "email_template" USING btree ("kind");
