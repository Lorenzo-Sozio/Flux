-- Migration: geo reference tables + FK columns on CRM entities
-- Adds geo_country and geo_city tables, plus country_id/city_id FKs on lead/contact/company.
-- Existing text fields (city, country) are preserved as denormalized cache — no data loss.

CREATE TABLE "geo_country" (
  "id" text PRIMARY KEY NOT NULL,
  "iso2" text NOT NULL,
  "iso3" text,
  "name_en" text NOT NULL,
  "name_it" text,
  "calling_code" text,
  "active" boolean NOT NULL DEFAULT true,
  CONSTRAINT "geo_country_iso2_uniq" UNIQUE("iso2")
);

CREATE TABLE "geo_city" (
  "id" text PRIMARY KEY NOT NULL,
  "country_id" text NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "region" text,
  "postal_codes" text[] DEFAULT '{}',
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "geo_city_country_slug_uniq" UNIQUE("country_id", "slug"),
  CONSTRAINT "geo_city_country_fk" FOREIGN KEY ("country_id") REFERENCES "geo_country"("id") ON DELETE CASCADE
);

-- Add FK columns to existing CRM entities (nullable — backward compatible)
ALTER TABLE "lead"    ADD COLUMN "country_id" text;
ALTER TABLE "lead"    ADD COLUMN "city_id"    text;
ALTER TABLE "contact" ADD COLUMN "country_id" text;
ALTER TABLE "contact" ADD COLUMN "city_id"    text;
ALTER TABLE "company" ADD COLUMN "country_id" text;
ALTER TABLE "company" ADD COLUMN "city_id"    text;

-- Indexes on new FK columns
CREATE INDEX "lead_country_id_idx"    ON "lead"("country_id");
CREATE INDEX "lead_city_id_idx"       ON "lead"("city_id");
CREATE INDEX "contact_country_id_idx" ON "contact"("country_id");
CREATE INDEX "contact_city_id_idx"    ON "contact"("city_id");
CREATE INDEX "company_country_id_idx" ON "company"("country_id");
CREATE INDEX "company_city_id_idx"    ON "company"("city_id");

-- Indexes on existing text columns (lower-case) to speed up the ILIKE filters already in use
CREATE INDEX "lead_city_txt_idx"      ON "lead"(lower("city"));
CREATE INDEX "lead_country_txt_idx"   ON "lead"(lower("country"));
CREATE INDEX "contact_city_txt_idx"   ON "contact"(lower("city"));
CREATE INDEX "contact_country_txt_idx" ON "contact"(lower("country"));
CREATE INDEX "company_city_txt_idx"   ON "company"(lower("city"));
CREATE INDEX "company_country_txt_idx" ON "company"(lower("country"));

-- FK constraints on CRM entity columns (added after indexes for performance)
ALTER TABLE "lead"    ADD CONSTRAINT "lead_country_id_fk"    FOREIGN KEY ("country_id") REFERENCES "geo_country"("id") ON DELETE SET NULL;
ALTER TABLE "lead"    ADD CONSTRAINT "lead_city_id_fk"       FOREIGN KEY ("city_id")    REFERENCES "geo_city"("id")    ON DELETE SET NULL;
ALTER TABLE "contact" ADD CONSTRAINT "contact_country_id_fk" FOREIGN KEY ("country_id") REFERENCES "geo_country"("id") ON DELETE SET NULL;
ALTER TABLE "contact" ADD CONSTRAINT "contact_city_id_fk"    FOREIGN KEY ("city_id")    REFERENCES "geo_city"("id")    ON DELETE SET NULL;
ALTER TABLE "company" ADD CONSTRAINT "company_country_id_fk" FOREIGN KEY ("country_id") REFERENCES "geo_country"("id") ON DELETE SET NULL;
ALTER TABLE "company" ADD CONSTRAINT "company_city_id_fk"    FOREIGN KEY ("city_id")    REFERENCES "geo_city"("id")    ON DELETE SET NULL;

-- Best-effort back-fill: resolve country_id from existing text values where an exact match exists.
-- Runs only after user manually populates geo_country via the UI; safe to run again any time.
-- (No geo_country rows exist at migration time — this is a no-op on first apply.)
UPDATE "lead" l
SET country_id = gc.id
FROM geo_country gc
WHERE lower(l.country) = lower(gc.name_en)
  AND l.country IS NOT NULL
  AND l.country_id IS NULL;

UPDATE "contact" c
SET country_id = gc.id
FROM geo_country gc
WHERE lower(c.country) = lower(gc.name_en)
  AND c.country IS NOT NULL
  AND c.country_id IS NULL;

UPDATE "company" co
SET country_id = gc.id
FROM geo_country gc
WHERE lower(co.country) = lower(gc.name_en)
  AND co.country IS NOT NULL
  AND co.country_id IS NULL;
