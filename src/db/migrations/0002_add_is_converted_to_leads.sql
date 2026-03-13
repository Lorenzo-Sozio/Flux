CREATE TABLE "deal" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"amount" numeric(12, 2),
	"currency" text DEFAULT 'USD' NOT NULL,
	"expected_close_date" timestamp,
	"stage_id" text,
	"company_id" text,
	"contact_id" text,
	"owner_id" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_stage" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"order" integer NOT NULL,
	"color" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"due_date" timestamp,
	"status" text DEFAULT 'todo' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"owner_id" text,
	"lead_id" text,
	"contact_id" text,
	"company_id" text,
	"deal_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity" DROP CONSTRAINT "activity_opportunity_id_opportunity_id_fk";
--> statement-breakpoint
ALTER TABLE "activity" DROP CONSTRAINT "activity_assigned_to_user_id_fk";
--> statement-breakpoint
ALTER TABLE "activity" ADD COLUMN "content" text;--> statement-breakpoint
ALTER TABLE "activity" ADD COLUMN "date" timestamp;--> statement-breakpoint
ALTER TABLE "activity" ADD COLUMN "owner_id" text;--> statement-breakpoint
ALTER TABLE "activity" ADD COLUMN "deal_id" text;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "vat_number" text;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "sdi_code" text;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "tags" text[];--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "marketing_consent" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "consent_date" timestamp;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "tags" text[];--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "marketing_consent" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "consent_date" timestamp;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "tags" text[];--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "is_converted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "deal" ADD CONSTRAINT "deal_stage_id_pipeline_stage_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."pipeline_stage"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal" ADD CONSTRAINT "deal_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal" ADD CONSTRAINT "deal_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal" ADD CONSTRAINT "deal_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" DROP COLUMN "title";--> statement-breakpoint
ALTER TABLE "activity" DROP COLUMN "description";--> statement-breakpoint
ALTER TABLE "activity" DROP COLUMN "due_date";--> statement-breakpoint
ALTER TABLE "activity" DROP COLUMN "status";--> statement-breakpoint
ALTER TABLE "activity" DROP COLUMN "opportunity_id";--> statement-breakpoint
ALTER TABLE "activity" DROP COLUMN "assigned_to";--> statement-breakpoint
ALTER TABLE "activity" DROP COLUMN "updated_at";