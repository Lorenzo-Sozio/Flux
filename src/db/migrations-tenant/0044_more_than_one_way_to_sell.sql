-- More than one pipeline (V3.8): a stage belongs to one, and a deal belongs to its stage's.
-- Every existing stage lands in the "default" pipeline, and so does every stage seeded
-- later without saying otherwise — the column's default.
--
-- ⚠️ No foreign key: Postgres has no ADD CONSTRAINT IF NOT EXISTS, and a tenant migration
-- must survive being run twice. The actions keep a stage's pipeline real.
--
-- Additive and re-runnable, like every tenant migration.
CREATE TABLE IF NOT EXISTS "pipeline" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
INSERT INTO "pipeline" ("id", "name", "order") VALUES ('default', 'Pipeline', 0) ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "pipeline_stage" ADD COLUMN IF NOT EXISTS "pipeline_id" text DEFAULT 'default' NOT NULL;
