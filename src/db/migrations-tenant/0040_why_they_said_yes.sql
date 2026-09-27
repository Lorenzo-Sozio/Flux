-- Where a person's marketing consent came from — typed in a form, an import, the API, an
-- unsubscribe link — beside the date of the latest decision (V2.11, §13.8). The history of
-- the switch itself is in `field_change`.
--
-- Additive and re-runnable, like every tenant migration.
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "consent_source" text;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN IF NOT EXISTS "consent_source" text;
