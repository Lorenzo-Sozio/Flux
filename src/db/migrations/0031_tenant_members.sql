CREATE TABLE "tenant_members" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "role" text NOT NULL DEFAULT 'editor',
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "tenant_members_tenant_user_unique" UNIQUE("tenant_id", "user_id")
);
