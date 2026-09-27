-- Appointment reminders: the lead time was stored and went only into the .ics
-- attachment, so nobody inside the workspace was ever reminded of anything.
-- `reminder_sent_at` is the memory of the job that now does it: set by the
-- conditional update that claims a reminder, cleared when the appointment moves.
--
-- Additive and re-runnable, like every tenant migration.
ALTER TABLE "appointment" ADD COLUMN IF NOT EXISTS "reminder_sent_at" timestamp;
