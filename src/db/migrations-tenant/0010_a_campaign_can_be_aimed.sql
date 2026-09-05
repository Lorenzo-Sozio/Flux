-- A campaign remembers the segment it was aimed at.
--
-- Sending could be pointed at every contact with marketing consent, or every
-- lead, and at nothing narrower. The saved filters the lists are built on —
-- "customers in Lombardy", "leads scoring over sixty" — existed and could not be
-- used in the one place where sending to the wrong people costs something.
--
-- Null on every campaign that exists today, which means exactly what it meant
-- before: everybody eligible. Nothing changes for a campaign already scheduled.
--
-- Kept on the campaign rather than passed at send time because a scheduled send
-- happens hours or days later, when whoever chose the segment has gone home.
ALTER TABLE "marketing_campaign" ADD COLUMN IF NOT EXISTS "recipient_filter_id" text;
--> statement-breakpoint
-- Separately and guarded: a constraint cannot be added twice, and this migration
-- may be re-applied to a database that already carries it. ON DELETE SET NULL,
-- because deleting a saved view should widen a campaign back to everybody rather
-- than break the row.
DO $$
BEGIN
  ALTER TABLE "marketing_campaign"
    ADD CONSTRAINT "marketing_campaign_recipient_filter_id_custom_filter_id_fk"
    FOREIGN KEY ("recipient_filter_id") REFERENCES "custom_filter"("id") ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_table THEN NULL;
END $$;
