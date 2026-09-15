-- Who issues the invoices, and what a customer needs to receive one.
--
-- Additive and re-runnable, as every tenant migration has to be. Nothing here is
-- NOT NULL on existing rows: the checks that matter run when an invoice is issued.
ALTER TABLE "company" ADD COLUMN IF NOT EXISTS "fiscal_code" text;
--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN IF NOT EXISTS "pec" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invoice_issuer" (
	"id" text PRIMARY KEY DEFAULT 'workspace' NOT NULL,
	"legal_name" text,
	"vat_number" text,
	"fiscal_code" text,
	"tax_regime" text DEFAULT 'RF01',
	"street" text,
	"zip_code" text,
	"city" text,
	"province" text,
	"country" text DEFAULT 'IT',
	"rea_office" text,
	"rea_number" text,
	"share_capital" numeric(15, 2),
	"sole_shareholder" text,
	"liquidation_status" text,
	"email" text,
	"phone" text,
	"iban" text,
	"bank_name" text,
	"updated_by" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
