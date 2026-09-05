-- What has been paid on an order, and when it was delivered.
--
-- An order carried a total and nothing about money actually arriving, so the
-- question a business asks about an order more often than any other — has this
-- been paid — was answered by somebody remembering, or by opening the bank. The
-- translation files even carried the words for it, describing columns that had
-- never existed.
--
-- ⚠️ Payments are rows, not a `paid_amount` column. A single field survives
-- exactly one instalment: the second overwrites the first and who paid what, when,
-- is gone. A deposit followed by a balance is the ordinary case, not the exotic
-- one. The order keeps no cached sum either: a stored total and a set of rows
-- disagree the first time one is written without the other, and the figure a
-- person believes is whichever the screen happens to show.
CREATE TABLE IF NOT EXISTS "order_payment" (
  "id" text PRIMARY KEY NOT NULL,
  "order_id" text NOT NULL,
  "amount" numeric(12, 2) NOT NULL,
  "paid_at" timestamp DEFAULT now() NOT NULL,
  "method" text,
  "note" text,
  "recorded_by_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- ON DELETE CASCADE: payments against an order that no longer exists are not a
-- record of anything, and only draft or cancelled orders can be deleted at all.
DO $$
BEGIN
  ALTER TABLE "order_payment"
    ADD CONSTRAINT "order_payment_order_id_order_id_fk"
    FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_table THEN NULL;
END $$;
--> statement-breakpoint
-- SET NULL: a person leaving the company does not unrecord the money.
DO $$
BEGIN
  ALTER TABLE "order_payment"
    ADD CONSTRAINT "order_payment_recorded_by_id_user_id_fk"
    FOREIGN KEY ("recorded_by_id") REFERENCES "user"("id") ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_table THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_payment_order_id_idx" ON "order_payment" ("order_id");
--> statement-breakpoint
-- The date it reached the customer, which the status cannot say: "completed" is a
-- state somebody set, and support answering "it has not arrived" needs a when.
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "delivered_at" timestamp;
