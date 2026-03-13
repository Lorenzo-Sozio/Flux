ALTER TABLE "task" ADD COLUMN "assignee_id" text;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "completed_at" timestamp;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_assignee_id_user_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;