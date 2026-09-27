-- A person's public booking link, and the mark on an appointment that it was booked
-- through one (V3.5). The unique index is what stops two visitors taking the same slot:
-- the insert decides, since the HTTP driver holds no transaction to decide in.
--
-- Additive and re-runnable, like every tenant migration.
CREATE TABLE IF NOT EXISTS "booking_link" (
	"user_id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"title" text,
	"duration_minutes" integer DEFAULT 30 NOT NULL,
	"days_ahead" integer DEFAULT 14 NOT NULL,
	"day_start" text DEFAULT '09:00' NOT NULL,
	"day_end" text DEFAULT '18:00' NOT NULL,
	"weekdays" text DEFAULT '12345' NOT NULL,
	"buffer_minutes" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "booking_link_token_idx" ON "booking_link" USING btree ("token");--> statement-breakpoint
ALTER TABLE "appointment" ADD COLUMN IF NOT EXISTS "booked_via" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "appointment_booked_slot_idx" ON "appointment" USING btree ("organizer_id", "start_at") WHERE "booked_via" IS NOT NULL AND "status" <> 'cancelled';
