-- Add last_migrated_at to tenants table to track when each tenant DB was last migrated
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "last_migrated_at" timestamp;
