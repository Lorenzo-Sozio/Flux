-- Lead conversion traceability: adds bidirectional links and history migration support

-- Traceability fields on leads
ALTER TABLE "lead" ADD COLUMN "converted_at" timestamp;
ALTER TABLE "lead" ADD COLUMN "converted_to_contact_id" text;
ALTER TABLE "lead" ADD COLUMN "converted_to_company_id" text;
ALTER TABLE "lead" ADD COLUMN "converted_to_deal_id" text;
--> statement-breakpoint

-- Back-reference fields on contact and company
ALTER TABLE "contact" ADD COLUMN "source_lead_id" text;
ALTER TABLE "company" ADD COLUMN "source_lead_id" text;
--> statement-breakpoint

-- Foreign key constraints
ALTER TABLE "lead" ADD CONSTRAINT "lead_converted_to_contact_id_contact_id_fk" FOREIGN KEY ("converted_to_contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_converted_to_company_id_company_id_fk" FOREIGN KEY ("converted_to_company_id") REFERENCES "public"."company"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_converted_to_deal_id_deal_id_fk" FOREIGN KEY ("converted_to_deal_id") REFERENCES "public"."deal"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_source_lead_id_lead_id_fk" FOREIGN KEY ("source_lead_id") REFERENCES "public"."lead"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "company" ADD CONSTRAINT "company_source_lead_id_lead_id_fk" FOREIGN KEY ("source_lead_id") REFERENCES "public"."lead"("id") ON DELETE set null ON UPDATE no action;
