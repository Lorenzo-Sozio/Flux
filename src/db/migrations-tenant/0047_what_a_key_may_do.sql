-- API keys with a name and scopes, entity by entity (L9, decision D7).
--
-- In the workspace's own database rather than the platform registry: tenant migrations
-- apply themselves the first time a workspace is used, while the registry is migrated by
-- hand, and an authentication path reading a table that is not there yet refuses every
-- integration at once. A key carries its workspace id in clear, so the gate knows which
-- database to look in; only the SHA-256 of the whole key is stored.
--
-- Additive and re-runnable, like every tenant migration.
CREATE TABLE IF NOT EXISTS "api_key" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"hash" text NOT NULL,
	"hint" text NOT NULL,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp,
	"revoked_at" timestamp
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "api_key_hash_idx" ON "api_key" USING btree ("hash");
