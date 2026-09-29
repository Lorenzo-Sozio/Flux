-- When the FatturaPA file of an issued invoice was first downloaded: until then the invoice
-- page reminds whoever issued it that the file still has to reach SDI. An invoice that is
-- numbered and never transmitted is one the customer's accountant never receives.
--
-- Additive and re-runnable, like every tenant migration.
ALTER TABLE "invoice" ADD COLUMN IF NOT EXISTS "xml_downloaded_at" timestamp;
--> statement-breakpoint
-- The last payment reminder sent for an overdue invoice, and how many: the page says when the
-- customer was last reminded, and a second click within the hour sends nothing.
ALTER TABLE "invoice" ADD COLUMN IF NOT EXISTS "reminded_at" timestamp;
--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN IF NOT EXISTS "reminder_count" integer DEFAULT 0 NOT NULL;
