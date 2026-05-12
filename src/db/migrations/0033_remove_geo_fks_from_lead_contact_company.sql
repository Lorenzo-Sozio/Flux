-- Drops legacy geo FK columns from lead, contact, and company.
-- These columns are no longer used now that city/country are stored as plain text.

ALTER TABLE "lead" DROP CONSTRAINT IF EXISTS "lead_country_id_fk";
ALTER TABLE "lead" DROP CONSTRAINT IF EXISTS "lead_city_id_fk";
ALTER TABLE "lead" DROP CONSTRAINT IF EXISTS "lead_country_id_geo_country_id_fk";
ALTER TABLE "lead" DROP CONSTRAINT IF EXISTS "lead_city_id_geo_city_id_fk";
DROP INDEX IF EXISTS "lead_country_id_idx";
DROP INDEX IF EXISTS "lead_city_id_idx";
ALTER TABLE "lead" DROP COLUMN IF EXISTS "country_id";
ALTER TABLE "lead" DROP COLUMN IF EXISTS "city_id";

ALTER TABLE "contact" DROP CONSTRAINT IF EXISTS "contact_country_id_fk";
ALTER TABLE "contact" DROP CONSTRAINT IF EXISTS "contact_city_id_fk";
ALTER TABLE "contact" DROP CONSTRAINT IF EXISTS "contact_country_id_geo_country_id_fk";
ALTER TABLE "contact" DROP CONSTRAINT IF EXISTS "contact_city_id_geo_city_id_fk";
DROP INDEX IF EXISTS "contact_country_id_idx";
DROP INDEX IF EXISTS "contact_city_id_idx";
ALTER TABLE "contact" DROP COLUMN IF EXISTS "country_id";
ALTER TABLE "contact" DROP COLUMN IF EXISTS "city_id";

ALTER TABLE "company" DROP CONSTRAINT IF EXISTS "company_country_id_fk";
ALTER TABLE "company" DROP CONSTRAINT IF EXISTS "company_city_id_fk";
ALTER TABLE "company" DROP CONSTRAINT IF EXISTS "company_country_id_geo_country_id_fk";
ALTER TABLE "company" DROP CONSTRAINT IF EXISTS "company_city_id_geo_city_id_fk";
DROP INDEX IF EXISTS "company_country_id_idx";
DROP INDEX IF EXISTS "company_city_id_idx";
ALTER TABLE "company" DROP COLUMN IF EXISTS "country_id";
ALTER TABLE "company" DROP COLUMN IF EXISTS "city_id";
