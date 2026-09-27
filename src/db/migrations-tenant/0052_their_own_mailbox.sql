-- A person's own mailbox and calendar at Google or Microsoft (V3.2, decision D-B).
--
-- One connection per person. The tokens are encrypted with the platform key, like the
-- workspace's email credentials, and rotated with them (scripts/rotate-platform-key.ts).
-- Busy time read from the provider is kept as bare intervals — no titles, no attendees —
-- and replaced whole at each read. A mirror row remembers which event at the provider
-- stands for which appointment; it has no foreign key to the appointment, because a
-- deleted appointment still has an event to delete.
--
-- Additive and re-runnable, like every tenant migration.
CREATE TABLE IF NOT EXISTS "mail_connection" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
	"provider" text NOT NULL,
	"email" text NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text,
	"expires_at" timestamp NOT NULL,
	"scopes" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_error" text,
	"last_error_at" timestamp,
	"mail_cursor" text,
	"mail_synced_at" timestamp,
	"busy_synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mail_connection_user" ON "mail_connection" ("user_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mail_busy" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_id" text NOT NULL REFERENCES "mail_connection"("id") ON DELETE CASCADE,
	"user_id" text NOT NULL,
	"start_at" timestamp NOT NULL,
	"end_at" timestamp NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mail_busy_user_start" ON "mail_busy" ("user_id", "start_at");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "appointment_mirror" (
	"id" text PRIMARY KEY NOT NULL,
	"appointment_id" text NOT NULL,
	"connection_id" text NOT NULL REFERENCES "mail_connection"("id") ON DELETE CASCADE,
	"external_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "appointment_mirror_unique" ON "appointment_mirror" ("appointment_id", "connection_id");
