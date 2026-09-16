-- Where an issued invoice's files are kept, and what they hashed to when written,
-- plus the last time a courtesy copy was emailed and to whom.
--
-- Additive and re-runnable, as every tenant migration has to be.
ALTER TABLE "invoice" ADD COLUMN IF NOT EXISTS "xml_key" text;
--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN IF NOT EXISTS "xml_sha256" text;
--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN IF NOT EXISTS "pdf_key" text;
--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN IF NOT EXISTS "pdf_sha256" text;
--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN IF NOT EXISTS "archived_at" timestamp;
--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN IF NOT EXISTS "emailed_at" timestamp;
--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN IF NOT EXISTS "emailed_to" text;
