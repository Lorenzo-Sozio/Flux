-- Territories: named areas a workspace routes and reports records by.
--
-- ⚠️ No column is added to lead, contact or company. Which territory a record is
-- in is computed from its address at read time (src/lib/territory.ts), so a
-- change to a territory applies to every record at once and no write path has to
-- remember to keep a stored answer current.
--
-- Additive and re-runnable, as every tenant migration has to be.
CREATE TABLE IF NOT EXISTS "territory" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	-- ISO 3166-1 alpha-2 codes.
	"countries" text[] DEFAULT '{}' NOT NULL,
	-- Provinces, regions or states as typed; matched after normalisation.
	"states" text[] DEFAULT '{}' NOT NULL,
	"postal_prefixes" text[] DEFAULT '{}' NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "territory_name_uniq" UNIQUE("name")
);
