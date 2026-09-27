-- A task says what kind of contact it is (a call, an email, a meeting, or simply
-- something to do), and completing it records what happened: the activity it becomes
-- carries the outcome and points back at the task it came from.
--
-- Existing tasks become "todo", which is what they were: nothing said otherwise.
--
-- Additive and re-runnable, like every tenant migration.
ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "type" text DEFAULT 'todo' NOT NULL;--> statement-breakpoint
ALTER TABLE "activity" ADD COLUMN IF NOT EXISTS "outcome" text;--> statement-breakpoint
ALTER TABLE "activity" ADD COLUMN IF NOT EXISTS "task_id" text;
