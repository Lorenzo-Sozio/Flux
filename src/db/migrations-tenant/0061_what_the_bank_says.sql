-- Bank reconciliation (I13). A workspace's accounts, the lines of their statements, and what
-- each payer's IBAN has been seen paying for.
--
-- A line is reconciled when receipts name it (`receipt.bank_transaction_id`, which I10 left
-- ready): the new receipt a confirmation writes, or receipts typed by hand before the
-- statement arrived. There is no "matched" flag to keep in step with them — the receipts are
-- the fact. A line nobody needs to explain (bank charges, a supplier paid) is ignored instead.
--
-- The same statement imported twice adds nothing: a line is kept under a fingerprint of its
-- day, amount, the bank's reference and description, unique per account.
--
-- Additive and re-runnable, like every tenant migration.
CREATE TABLE IF NOT EXISTS "bank_account" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"iban" text,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"csv_mapping" jsonb,
	"archived_at" timestamp,
	"created_by_id" text REFERENCES "user"("id") ON DELETE SET NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_import" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL REFERENCES "bank_account"("id") ON DELETE CASCADE,
	"file_name" text,
	"format" text NOT NULL,
	"created" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"created_by_id" text REFERENCES "user"("id") ON DELETE SET NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_transaction" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL REFERENCES "bank_account"("id") ON DELETE CASCADE,
	"import_id" text REFERENCES "bank_import"("id") ON DELETE SET NULL,
	"booked_on" date NOT NULL,
	"value_on" date,
	"amount" numeric(12, 2) NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"counterparty_name" text,
	"counterparty_iban" text,
	"remittance" text,
	"bank_reference" text,
	"fingerprint" text NOT NULL,
	"ignored_at" timestamp,
	"ignored_by_id" text REFERENCES "user"("id") ON DELETE SET NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bank_transaction_fingerprint_idx" ON "bank_transaction" ("account_id", "fingerprint");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bank_transaction_booked_idx" ON "bank_transaction" ("account_id", "booked_on");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "company_iban" (
	"iban" text NOT NULL,
	"company_id" text NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
	"seen" integer DEFAULT 1 NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	PRIMARY KEY ("iban", "company_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "receipt_bank_transaction_idx" ON "receipt" ("bank_transaction_id");
