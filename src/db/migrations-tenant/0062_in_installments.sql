-- Payment terms and installments (I12). A customer's default terms, an invoice's own terms
-- (a preset or installments written by hand), and the installments frozen when it is issued:
-- the dates and amounts the XML states and the receivables schedule reads.
--
-- Additive and re-runnable, like every tenant migration.
ALTER TABLE "company" ADD COLUMN IF NOT EXISTS "payment_terms" text;
--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN IF NOT EXISTS "payment_terms" jsonb;
--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN IF NOT EXISTS "installments" jsonb;
