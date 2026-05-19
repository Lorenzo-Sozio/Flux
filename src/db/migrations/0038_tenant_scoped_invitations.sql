-- Add tenant-scoped invitation support to user_invitation table
ALTER TABLE "user_invitation" ADD COLUMN IF NOT EXISTS "tenant_id" text;
ALTER TABLE "user_invitation" ADD COLUMN IF NOT EXISTS "tenant_role" text DEFAULT 'editor';
