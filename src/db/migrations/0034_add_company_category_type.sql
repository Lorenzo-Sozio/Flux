CREATE TABLE IF NOT EXISTS "company_category" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "company_category_name_unique" UNIQUE("name")
);

CREATE TABLE IF NOT EXISTS "company_type" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "company_type_name_unique" UNIQUE("name")
);

ALTER TABLE "company" ADD COLUMN "company_category_id" text;
ALTER TABLE "company" ADD COLUMN "company_type_id" text;

ALTER TABLE "company" ADD CONSTRAINT "company_company_category_id_fk"
  FOREIGN KEY ("company_category_id") REFERENCES "public"."company_category"("id") ON DELETE set null ON UPDATE no action;

ALTER TABLE "company" ADD CONSTRAINT "company_company_type_id_fk"
  FOREIGN KEY ("company_type_id") REFERENCES "public"."company_type"("id") ON DELETE set null ON UPDATE no action;
