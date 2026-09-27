-- The workspace's public forms: one that files a lead, one that opens a ticket (V3.6).
-- The id is the token in the form's address.
--
-- Additive and re-runnable, like every tenant migration.
CREATE TABLE IF NOT EXISTS "web_form" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"owner_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "web_form_kind_idx" ON "web_form" USING btree ("kind");
