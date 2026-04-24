CREATE TABLE "ticket_audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"ticket_id" text NOT NULL,
	"actor_id" text,
	"actor_name" text,
	"action" text NOT NULL,
	"field" text,
	"old_value" text,
	"new_value" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_macro" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"body" text NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ticket" ALTER COLUMN "status" SET DEFAULT 'new';--> statement-breakpoint
ALTER TABLE "ticket_message" ADD COLUMN "email_message_id" text;--> statement-breakpoint
ALTER TABLE "ticket_message" ADD COLUMN "email_in_reply_to" text;--> statement-breakpoint
ALTER TABLE "ticket" ADD COLUMN "type" text DEFAULT 'support';--> statement-breakpoint
ALTER TABLE "ticket" ADD COLUMN "component" text;--> statement-breakpoint
ALTER TABLE "ticket" ADD COLUMN "group_id" text;--> statement-breakpoint
ALTER TABLE "ticket" ADD COLUMN "parent_ticket_id" text;--> statement-breakpoint
ALTER TABLE "ticket" ADD COLUMN "sla_deadline_at" timestamp;--> statement-breakpoint
ALTER TABLE "ticket" ADD COLUMN "sla_paused_at" timestamp;--> statement-breakpoint
ALTER TABLE "ticket" ADD COLUMN "sla_pause_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ticket" ADD COLUMN "sla_breached_at" timestamp;--> statement-breakpoint
ALTER TABLE "ticket_audit_log" ADD CONSTRAINT "ticket_audit_log_ticket_id_ticket_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."ticket"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_audit_log" ADD CONSTRAINT "ticket_audit_log_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_macro" ADD CONSTRAINT "ticket_macro_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_group_id_user_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."user_group"("id") ON DELETE set null ON UPDATE no action;