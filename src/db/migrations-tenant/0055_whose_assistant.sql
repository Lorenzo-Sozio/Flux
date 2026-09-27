-- Which key marked a person «with the assistant» (decided 27 September 2026).
--
-- Any key could clear a mark another integration had set, and the person went back into
-- every campaign and sequence while the assistant was still talking to them. The key that
-- marked is now remembered; only that key clears it. Marks made before this column name no
-- key, and any key may clear them, as before.
--
-- Additive and re-runnable, like every tenant migration.
ALTER TABLE "lead" ADD COLUMN IF NOT EXISTS "assistant_key_id" text;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "assistant_key_id" text;
