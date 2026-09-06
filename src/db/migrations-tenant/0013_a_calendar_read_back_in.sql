-- The address of a calendar this person publishes elsewhere, so appointments made
-- in Google, Outlook or Apple show up here instead of being booked over.
--
-- Additive and re-runnable, as every tenant migration has to be: the Neon HTTP
-- driver holds no session, so a migration that fails halfway leaves the statements
-- before it applied and records nothing.
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "external_calendar_url" text;
