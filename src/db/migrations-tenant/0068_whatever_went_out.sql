-- A second intermediary (Fatture in Cloud, src/lib/sdi/fattureincloud.ts), which builds its own
-- FatturaPA file from the invoice's data instead of taking Flux's:
--
-- sdi_setting.account_id: the account inside the intermediary the invoices belong to (Fatture in
--   Cloud's company id);
-- invoice.sdi_ref: the intermediary's own id for what it holds (the document id), what its status
--   is read by;
-- invoice.sdi_sent_xml: the file that actually went to SDI, when the intermediary built it — kept
--   so the XML downloaded from Flux is the XML SDI received.
--
-- Additive and re-runnable, like every tenant migration.
ALTER TABLE "sdi_setting" ADD COLUMN IF NOT EXISTS "account_id" text;
--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN IF NOT EXISTS "sdi_ref" text;
--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN IF NOT EXISTS "sdi_sent_xml" text;
