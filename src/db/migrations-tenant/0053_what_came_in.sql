-- Money that arrived, against an invoice as well as an order (I9).
--
-- A payment row may now name the invoice it settles, and an invoice written without an
-- order can be paid: the order becomes optional on the row. What a receivable still owes is
-- the invoice's total, less what its credit notes gave back, less the payments that name it.
--
-- Payments recorded before this named only their order. Where that order has exactly one
-- issued invoice (not a credit note) there is no doubt which one they paid, and they are
-- linked to it; where it has several, nobody can say which, and they stay on the order —
-- the invoice then reads unpaid until someone links them, which is the honest reading.
--
-- Additive and re-runnable, like every tenant migration: the link only fills an empty one.
ALTER TABLE "order_payment" ADD COLUMN IF NOT EXISTS "invoice_id" text REFERENCES "invoice"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "order_payment" ALTER COLUMN "order_id" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_payment_invoice_idx" ON "order_payment" ("invoice_id");--> statement-breakpoint
UPDATE "order_payment" p SET "invoice_id" = only_one.id
FROM (
	SELECT i."order_id", min(i."id") AS id
	FROM "invoice" i
	WHERE i."status" = 'issued' AND i."document_type" = 'TD01' AND i."order_id" IS NOT NULL
	GROUP BY i."order_id"
	HAVING count(*) = 1
) only_one
WHERE p."invoice_id" IS NULL AND p."order_id" = only_one."order_id";
