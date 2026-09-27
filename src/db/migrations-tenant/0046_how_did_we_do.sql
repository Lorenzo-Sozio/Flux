-- The customer's side of a ticket (V3.10, §12.3): a status page reached by a token nobody
-- can guess, and a one-click rating asked for once, when the ticket is resolved.
--
-- Additive and re-runnable, like every tenant migration. A unique index on a nullable
-- column admits any number of NULLs, so tickets that never had a token do not collide.
ALTER TABLE "ticket" ADD COLUMN IF NOT EXISTS "public_token" text;--> statement-breakpoint
ALTER TABLE "ticket" ADD COLUMN IF NOT EXISTS "csat_rating" text;--> statement-breakpoint
ALTER TABLE "ticket" ADD COLUMN IF NOT EXISTS "csat_comment" text;--> statement-breakpoint
ALTER TABLE "ticket" ADD COLUMN IF NOT EXISTS "csat_rated_at" timestamp;--> statement-breakpoint
ALTER TABLE "ticket" ADD COLUMN IF NOT EXISTS "csat_requested_at" timestamp;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ticket_public_token_idx" ON "ticket" USING btree ("public_token");
