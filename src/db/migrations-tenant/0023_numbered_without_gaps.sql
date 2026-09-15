-- Invoices and credit notes, and their lines.
--
-- ⚠️ No number on a draft: it is assigned when issuing, in one statement, so the
-- sequence has no gaps. The partial unique index is the backstop.
--
-- Additive and re-runnable, as every tenant migration has to be.
CREATE TABLE IF NOT EXISTS "invoice" (
	"id" text PRIMARY KEY NOT NULL,
	"document_type" text DEFAULT 'TD01' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"series" text DEFAULT '' NOT NULL,
	"fiscal_year" integer,
	"number" integer,
	"document_number" text,
	"issue_date" date,
	"due_date" date,
	"order_id" text REFERENCES "order"("id") ON DELETE SET NULL,
	"original_invoice_id" text REFERENCES "invoice"("id") ON DELETE SET NULL,
	"company_id" text REFERENCES "company"("id") ON DELETE SET NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"discount_percent" numeric(5, 2) DEFAULT '0' NOT NULL,
	"subtotal" numeric(12, 2) DEFAULT '0' NOT NULL,
	"discount_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"taxable_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"stamp_duty" boolean DEFAULT false NOT NULL,
	"total" numeric(12, 2) DEFAULT '0' NOT NULL,
	"payment_method" text DEFAULT 'MP05' NOT NULL,
	"notes" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"issuer_snapshot" jsonb,
	"customer_snapshot" jsonb,
	"lines_snapshot" jsonb,
	"created_by" text,
	"issued_by" text,
	"issued_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invoice_number_uniq" ON "invoice" ("series", "fiscal_year", "number") WHERE number IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoice_order_idx" ON "invoice" ("order_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoice_company_idx" ON "invoice" ("company_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invoice_item" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL REFERENCES "invoice"("id") ON DELETE CASCADE,
	"position" integer NOT NULL,
	"product_id" text REFERENCES "product"("id") ON DELETE SET NULL,
	"description" text NOT NULL,
	"quantity" numeric(12, 3) NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"discount_percent" numeric(5, 2) DEFAULT '0' NOT NULL,
	"tax_percent" numeric(5, 2) DEFAULT '0' NOT NULL,
	"nature" text,
	CONSTRAINT "invoice_item_position_uniq" UNIQUE("invoice_id", "position")
);
