CREATE TABLE "task_time_log" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"user_id" text NOT NULL,
	"started_at" timestamp NOT NULL,
	"stopped_at" timestamp,
	"hours" numeric(5, 2),
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "estimated_hours" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "actual_hours" numeric(5, 2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "task_time_log" ADD CONSTRAINT "task_time_log_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_time_log" ADD CONSTRAINT "task_time_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;