-- A receipt is money that arrived (I10): the day it reached the account, how much, the
-- bank's reference, the customer. Where it went is a separate question, answered by its
-- allocations — the `order_payment` rows, which now name their receipt.
--
-- One transfer used to be one row on one document, so a transfer paying two invoices could
-- not be written down, money paid beyond an invoice had nowhere to be, and deleting a
-- cancelled order deleted what the customer had paid on it. What arrived and where it went
-- are two facts: "collected" reads the first, what an invoice still owes reads the second,
-- and the difference is the customer's credit.
--
-- A negative receipt is money given back: a refund.
--
-- Every payment recorded before this becomes a receipt of its own, with the same id, the
-- currency of what it paid and the customer of that document. Additive and re-runnable, like
-- every tenant migration: the copy skips what it has already copied.
CREATE TABLE IF NOT EXISTS "receipt" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text REFERENCES "company"("id") ON DELETE SET NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"received_at" timestamp NOT NULL,
	"method" text,
	"reference" text,
	"note" text,
	"account_id" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"bank_transaction_id" text,
	"recorded_by_id" text REFERENCES "user"("id") ON DELETE SET NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by_id" text REFERENCES "user"("id") ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "receipt_company_idx" ON "receipt" ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "receipt_received_at_idx" ON "receipt" ("received_at");
--> statement-breakpoint
ALTER TABLE "order_payment" ADD COLUMN IF NOT EXISTS "receipt_id" text REFERENCES "receipt"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_payment_receipt_idx" ON "order_payment" ("receipt_id");
--> statement-breakpoint
INSERT INTO "receipt" ("id", "company_id", "amount", "currency", "received_at", "method", "note", "recorded_by_id", "created_at", "updated_at")
SELECT p."id", coalesce(i."company_id", o."company_id"), p."amount", coalesce(i."currency", o."currency", 'EUR'),
       p."paid_at", p."method", p."note", p."recorded_by_id", p."created_at", p."created_at"
FROM "order_payment" p
LEFT JOIN "invoice" i ON i."id" = p."invoice_id"
LEFT JOIN "order" o ON o."id" = p."order_id"
WHERE p."receipt_id" IS NULL AND NOT EXISTS (SELECT 1 FROM "receipt" r WHERE r."id" = p."id");
--> statement-breakpoint
UPDATE "order_payment" SET "receipt_id" = "id" WHERE "receipt_id" IS NULL;
