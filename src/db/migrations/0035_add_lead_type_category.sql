ALTER TABLE "lead" ADD COLUMN "lead_type_id" text;
ALTER TABLE "lead" ADD COLUMN "lead_category_id" text;

ALTER TABLE "lead" ADD CONSTRAINT "lead_lead_type_id_fk"
  FOREIGN KEY ("lead_type_id") REFERENCES "public"."company_type"("id") ON DELETE set null ON UPDATE no action;

ALTER TABLE "lead" ADD CONSTRAINT "lead_lead_category_id_fk"
  FOREIGN KEY ("lead_category_id") REFERENCES "public"."company_category"("id") ON DELETE set null ON UPDATE no action;
