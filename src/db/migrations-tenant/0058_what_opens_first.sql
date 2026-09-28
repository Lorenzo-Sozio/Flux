-- A person's own settings for this workspace, starting with the dashboard the home opens on.
--
-- Per person and not per browser: the choice follows somebody from the desk to the phone.
-- Not in notification_preference, which is about being told things; the language the
-- morning email is written in stays there.
--
-- Additive and re-runnable, like every tenant migration.
CREATE TABLE IF NOT EXISTS "user_preference" (
  "user_id" text PRIMARY KEY NOT NULL,
  "home_dashboard" text,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
