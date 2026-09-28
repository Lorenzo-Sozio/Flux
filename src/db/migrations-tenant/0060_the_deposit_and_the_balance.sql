-- A deposit invoice (TD02) and the invoice for the balance that deducts it (I11).
--
-- The customer pays a deposit on the order, and a payment received in advance has to be
-- invoiced when it arrives: that is the deposit invoice, a TD02. The final invoice then
-- lists the whole order and takes the deposits already invoiced off it, one line per VAT
-- rate, citing each deposit invoice.
--
-- `deducts` is written on the balance invoice while it is a draft: the deposit invoices it
-- will take off. `deducted_in_invoice_id` is written on a deposit invoice by the statement
-- that issues the balance, and only while it is still empty — so a deposit is taken off
-- once, whatever two people do at the same moment.
--
-- Additive and re-runnable, like every tenant migration.
ALTER TABLE "invoice" ADD COLUMN IF NOT EXISTS "deducts" jsonb;
--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN IF NOT EXISTS "deducted_in_invoice_id" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoice_deducted_in_idx" ON "invoice" ("deducted_in_invoice_id");
