-- A ticket can say which order it is about (support and sales stop being islands).
--
-- The two modules did not touch anywhere. An agent reading "my order has not
-- arrived" had nowhere to record which order, so the answer lived in the prose of
-- the message and nowhere a query could reach it; and the order had no way to
-- know that the customer had complained about it. Both sides of that question
-- were being answered by somebody remembering.
--
-- Nullable, and null on every ticket that exists: most tickets are not about an
-- order and saying so is the honest default.
ALTER TABLE "ticket" ADD COLUMN IF NOT EXISTS "order_id" text;
--> statement-breakpoint
-- Separately and guarded, and ON DELETE SET NULL: deleting an order should leave
-- the conversation about it readable rather than take it down too.
DO $$
BEGIN
  ALTER TABLE "ticket"
    ADD CONSTRAINT "ticket_order_id_order_id_fk"
    FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_table THEN NULL;
END $$;
