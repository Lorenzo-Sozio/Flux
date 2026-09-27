-- How many days a deal may sit in a stage before the board calls it stuck (V3.7). Null is
-- "no limit": the default, since a sensible number depends on how the workspace sells.
--
-- Additive and re-runnable, like every tenant migration.
ALTER TABLE "pipeline_stage" ADD COLUMN IF NOT EXISTS "stale_after_days" integer;
