-- A notification remembers how it was composed, so it can be read in the reader's language.
--
-- Notifications were written as finished English sentences — "Task due today", "SLA
-- missed", "Upcoming appointment" — in a product whose people mostly read Italian. The key
-- and its values let the bell compose the text again, in whichever language the person
-- reading it has chosen; `title` and `message` keep the text composed at the time, which is
-- what a push carries and what older rows still show.
--
-- Additive and re-runnable, like every tenant migration.
ALTER TABLE "notification" ADD COLUMN IF NOT EXISTS "title_key" text;
--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN IF NOT EXISTS "params" jsonb;
