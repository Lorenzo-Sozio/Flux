-- A file sent in a chat message: which message, which conversation (so that "may this
-- person read it" is one join), where the bytes are in object storage, and what the
-- sender called it. The bytes themselves never touch the database.
--
-- Additive and re-runnable, like every tenant migration.
CREATE TABLE IF NOT EXISTS "dm_attachment" (
	"id" text PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"storage_key" text NOT NULL,
	"name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dm_attachment" ADD CONSTRAINT "dm_attachment_message_id_dm_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."dm_message"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dm_attachment" ADD CONSTRAINT "dm_attachment_conversation_id_dm_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."dm_conversation"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dm_attachment_message_idx" ON "dm_attachment" USING btree ("message_id");
