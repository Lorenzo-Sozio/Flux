CREATE TABLE "saved_report" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "config" text NOT NULL,
  "owner_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "is_public" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
