-- How much of an issued invoice its issued credit notes have taken back. Advanced in
-- the same statement that issues a credit note, and only while it stays within the
-- invoice total, so two credit notes issued together cannot give back more than was
-- invoiced.
--
-- Additive and re-runnable, as every tenant migration has to be.
ALTER TABLE "invoice" ADD COLUMN IF NOT EXISTS "credited_amount" numeric(12, 2) DEFAULT '0' NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoice_original_idx" ON "invoice" USING btree ("original_invoice_id");
