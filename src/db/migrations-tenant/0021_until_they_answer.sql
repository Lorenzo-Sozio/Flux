-- Follow-up sequences: steps, and the people walking through them.
--
-- ⚠️ One active enrollment per sequence and address is a partial unique index,
-- not a check in code: two enrolments racing would both pass a check.
--
-- Additive and re-runnable, as every tenant migration has to be.
CREATE TABLE IF NOT EXISTS "email_sequence" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"entity_type" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"owner_id" text REFERENCES "user"("id") ON DELETE SET NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_sequence_step" (
	"id" text PRIMARY KEY NOT NULL,
	"sequence_id" text NOT NULL REFERENCES "email_sequence"("id") ON DELETE CASCADE,
	"position" integer NOT NULL,
	"delay_days" integer DEFAULT 0 NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "email_sequence_step_position_uniq" UNIQUE("sequence_id", "position")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_sequence_enrollment" (
	"id" text PRIMARY KEY NOT NULL,
	"sequence_id" text NOT NULL REFERENCES "email_sequence"("id") ON DELETE CASCADE,
	"lead_id" text REFERENCES "lead"("id") ON DELETE CASCADE,
	"contact_id" text REFERENCES "contact"("id") ON DELETE CASCADE,
	"email" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"stop_reason" text,
	"next_step" integer DEFAULT 0 NOT NULL,
	"next_send_at" timestamp,
	"last_sent_at" timestamp,
	"owner_id" text,
	"enrolled_by" text,
	"enrolled_at" timestamp DEFAULT now() NOT NULL,
	"stopped_at" timestamp,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "email_sequence_enrollment_active_uniq" ON "email_sequence_enrollment" ("sequence_id", "email") WHERE status = 'active';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_sequence_enrollment_due_idx" ON "email_sequence_enrollment" ("status", "next_send_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_sequence_enrollment_email_idx" ON "email_sequence_enrollment" ("email");
--> statement-breakpoint
-- Lets stopping an enrollment cancel the email already queued for it.
ALTER TABLE "email_job" ADD COLUMN IF NOT EXISTS "sequence_enrollment_id" text REFERENCES "email_sequence_enrollment"("id") ON DELETE SET NULL;
--> statement-breakpoint
-- The provider's message id, so a bounce on an email that is not part of a
-- campaign still finds its workspace.
ALTER TABLE "email_job" ADD COLUMN IF NOT EXISTS "message_id" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_job_message_id_idx" ON "email_job" ("message_id");
