-- The email builder's blocks, kept beside the HTML they compile to.
--
-- The builder always sent its design with a save, and nothing kept it: the action's
-- schema dropped the field and the table had no column for it. So a template reopened
-- in the builder showed the placeholder email, and saving it replaced the real one.
-- Templates saved before this column have none, and open as the HTML they are.
--
-- Additive and re-runnable, like every tenant migration.
ALTER TABLE "email_template" ADD COLUMN IF NOT EXISTS "design" text;
