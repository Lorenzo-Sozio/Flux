CREATE TABLE IF NOT EXISTS "tenants" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "subdomain" text NOT NULL,
  "db_url" text NOT NULL,
  "settings" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "tenants_subdomain_unique" UNIQUE("subdomain")
);
