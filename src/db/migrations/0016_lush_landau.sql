CREATE TABLE "task_dependency" (
	"id" text PRIMARY KEY NOT NULL,
	"predecessor_id" text NOT NULL,
	"successor_id" text NOT NULL,
	"type" text DEFAULT 'FS' NOT NULL,
	"lag_days" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_dependency" ADD CONSTRAINT "task_dependency_predecessor_id_task_id_fk" FOREIGN KEY ("predecessor_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependency" ADD CONSTRAINT "task_dependency_successor_id_task_id_fk" FOREIGN KEY ("successor_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;