-- Stamp duty decided from the Natura codes, with a reason for any override, and
-- whether the issuer recharges it to the customer.
--
-- Additive and re-runnable, as every tenant migration has to be.
ALTER TABLE "invoice" ADD COLUMN IF NOT EXISTS "stamp_duty_mode" text DEFAULT 'auto' NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN IF NOT EXISTS "stamp_duty_note" text;
--> statement-breakpoint
ALTER TABLE "invoice_issuer" ADD COLUMN IF NOT EXISTS "recharge_stamp_duty" boolean DEFAULT false NOT NULL;
