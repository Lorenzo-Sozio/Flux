-- Where an order is on its way to the customer (src/actions/orders.ts `setOrderShipping`).
--
-- order.expected_delivery_date: the day the customer was told to expect it. `delivered_at` is when
--   it did arrive; the two are different questions and support needs both.
-- order.carrier / order.tracking_code: who carries it and the code to follow it.
--
-- They are what the order emails say ("[data di consegna]", "[corriere]", "[codice di
-- tracciamento]" in the basic templates), filled from the order instead of typed by hand.
--
-- Additive and re-runnable, like every tenant migration.
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "expected_delivery_date" date;
--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "carrier" text;
--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "tracking_code" text;
