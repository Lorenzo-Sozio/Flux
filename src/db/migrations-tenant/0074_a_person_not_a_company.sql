-- A private customer is filed under a company record in their own name, because quotes and
-- invoices are made out to a company. The e-invoice must still name a natural person with
-- <Nome> and <Cognome>, not <Denominazione>: these two columns say who the person is
-- (src/lib/fatturapa/xml.ts). Filled by the lead conversion for a private customer, editable
-- on the company's billing tab.
--
-- Additive and re-runnable, like every tenant migration.
ALTER TABLE "company" ADD COLUMN IF NOT EXISTS "person_first_name" text;
--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN IF NOT EXISTS "person_last_name" text;
--> statement-breakpoint
-- Private customers converted before these columns existed: a company made from a lead with
-- no company name carries that lead's full name. Only those, only once, and only when no
-- VAT number says it is a business.
UPDATE "company" AS c
SET "person_first_name" = l."first_name", "person_last_name" = l."last_name"
FROM "lead" AS l
WHERE c."source_lead_id" = l."id"
  AND c."person_first_name" IS NULL
  AND c."person_last_name" IS NULL
  AND (c."vat_number" IS NULL OR c."vat_number" = '')
  AND (l."company_name" IS NULL OR l."company_name" = '')
  AND c."name" = trim(coalesce(l."first_name", '') || ' ' || coalesce(l."last_name", ''));
