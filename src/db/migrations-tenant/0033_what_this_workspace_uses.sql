-- One workspace's own settings, a value per key — first used for which optional parts of
-- the product it shows (project planning, internal chat).
--
-- Here and not in `tenants.settings` on the platform: that is a JSON string the platform
-- panel rewrites whole, so a key it does not know would vanish the first time somebody
-- changed the workspace's emoji. An empty table means every optional part is on, which is
-- what every workspace had before this; new workspaces are seeded with them off.
--
-- Additive and re-runnable, like every tenant migration.
CREATE TABLE IF NOT EXISTS "workspace_setting" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
