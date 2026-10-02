-- Where a customer came from, as one list (S1, src/lib/record-sources.ts).
--
-- The value on a record is the source's key; the name is what people read, null for a
-- built-in source until a workspace renames it (then it is translated). Retired, never
-- deleted: records filed under a source keep saying so after the campaign ends.
--
-- A deal carries its own source, copied from the lead it was converted from: without it a
-- sale could not be counted by where it came from, only the leads.
--
-- Additive and re-runnable, like every tenant migration. The seed never overwrites a
-- workspace's own changes: an existing key is left as it is.
CREATE TABLE IF NOT EXISTS "record_source" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text,
	"order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "record_source" ("key", "order") VALUES
	('ads_meta', 1),
	('ads_google', 2),
	('website', 3),
	('agent', 4),
	('referral', 5),
	('trade_show', 6),
	('linkedin', 7),
	('cold_outreach', 8),
	('advertisement', 9),
	('email_campaign', 10),
	('other', 11)
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "deal" ADD COLUMN IF NOT EXISTS "source" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deal_source_idx" ON "deal" USING btree ("source") WHERE "source" IS NOT NULL;
