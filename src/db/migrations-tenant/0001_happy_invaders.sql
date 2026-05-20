DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'user_invitation'
  ) THEN
    ALTER TABLE "user_invitation" ADD COLUMN IF NOT EXISTS "tenant_id" text;
    ALTER TABLE "user_invitation" ADD COLUMN IF NOT EXISTS "tenant_role" text DEFAULT 'editor';
  END IF;
END $$;
