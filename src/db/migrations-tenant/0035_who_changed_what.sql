-- Who changed which field of a deal, contact or company, from what to what.
--
-- The history of a record existed only on tickets and through the API; a deal's amount
-- halved, or its owner changed, left no trace anybody could read. One row per field per
-- save, shown on the record's timeline.
--
-- Values are stored as text as they were displayed-independent: an id stays an id (the
-- timeline resolves stage and owner names when it reads), a date is its ISO string.
--
-- Additive and re-runnable, like every tenant migration.
CREATE TABLE IF NOT EXISTS "field_change" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"field" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"changed_by" text,
	"changed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "field_change_entity_idx" ON "field_change" ("entity_type", "entity_id", "changed_at");
