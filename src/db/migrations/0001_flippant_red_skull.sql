ALTER TABLE "company" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "lead_score" integer;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "lead_score" integer;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "lead_score" integer;