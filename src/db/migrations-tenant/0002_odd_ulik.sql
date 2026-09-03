ALTER TABLE "deal" ADD COLUMN "closed_at" timestamp;--> statement-breakpoint
ALTER TABLE "deal" ADD COLUMN "lost_reason" text;--> statement-breakpoint
ALTER TABLE "order_item" ADD COLUMN "discount_percent" numeric(5, 2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "order_item" ADD COLUMN "discount_amount" numeric(12, 2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "order_item" ADD COLUMN "tax_percent" numeric(5, 2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "order_item" ADD COLUMN "tax_amount" numeric(12, 2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "subtotal" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "discount_percent" numeric(5, 2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "discount_amount" numeric(12, 2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "tax_amount" numeric(12, 2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "currency" text DEFAULT 'EUR' NOT NULL;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "quote_id" text;--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "deal_id" text;--> statement-breakpoint
ALTER TABLE "pipeline_stage" ADD COLUMN "is_won" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pipeline_stage" ADD COLUMN "is_lost" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "eur_rate" numeric(18, 8) DEFAULT '1';--> statement-breakpoint
ALTER TABLE "ticket" ADD COLUMN "first_response_due_at" timestamp;--> statement-breakpoint
ALTER TABLE "ticket" ADD COLUMN "first_response_breached_at" timestamp;--> statement-breakpoint
-- Declared without .references() in the schema to avoid a forward reference
-- (order is defined before quote), so the constraints are added here. ON DELETE
-- SET NULL: deleting a quote must not delete the order it produced.
ALTER TABLE "order" ADD CONSTRAINT "order_quote_id_quote_id_fk"
  FOREIGN KEY ("quote_id") REFERENCES "quote"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_deal_id_deal_id_fk"
  FOREIGN KEY ("deal_id") REFERENCES "deal"("id") ON DELETE SET NULL;--> statement-breakpoint
-- Existing pipelines get sensible terminal stages so dragging a card into the
-- final column closes the deal from day one instead of after a manual setup step.
UPDATE "pipeline_stage" SET "is_won" = true
  WHERE lower("name") LIKE '%won%' OR lower("name") LIKE '%vint%' OR lower("name") LIKE '%chius% vint%';--> statement-breakpoint
UPDATE "pipeline_stage" SET "is_lost" = true
  WHERE lower("name") LIKE '%lost%' OR lower("name") LIKE '%pers%';--> statement-breakpoint
-- Backfill a close date for deals that are already won or lost, so month-over-month
-- revenue stops being derived from the last time somebody edited the record.
UPDATE "deal" SET "closed_at" = "updated_at" WHERE "status" IN ('won', 'lost') AND "closed_at" IS NULL;--> statement-breakpoint
-- Orders predating the money columns: the old total was tax-free, so it is also
-- the net. Recording it as such keeps existing documents internally consistent.
UPDATE "order" SET "subtotal" = "total_amount" WHERE "subtotal" = 0;
