-- Transmitting issued invoices to SDI through an intermediary (Aruba first; src/lib/sdi/).
--
-- sdi_setting: one row per workspace — which intermediary, its test or real system, the
-- account's credentials and the token it issued, encrypted with the platform key.
-- invoice.sdi_*: where each invoice stands with SDI, the name the intermediary gave the file,
-- the transmitter the file was built with (frozen: Aruba requires its own code in the file,
-- and the file served for download must be the one that was sent) and its SHA-256.
--
-- Additive and re-runnable, like every tenant migration.
CREATE TABLE IF NOT EXISTS "sdi_setting" (
	"id" text PRIMARY KEY DEFAULT 'workspace' NOT NULL,
	"channel" text DEFAULT 'manual' NOT NULL,
	"environment" text DEFAULT 'demo' NOT NULL,
	"username" text,
	"password" text,
	"access_token" text,
	"access_expires_at" timestamp,
	"refresh_token" text,
	"refresh_expires_at" timestamp,
	"auto_send" boolean DEFAULT false NOT NULL,
	"updated_by" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN IF NOT EXISTS "sdi_channel" text;
--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN IF NOT EXISTS "sdi_transmitter" jsonb;
--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN IF NOT EXISTS "sdi_status" text;
--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN IF NOT EXISTS "sdi_file_name" text;
--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN IF NOT EXISTS "sdi_file_sha256" text;
--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN IF NOT EXISTS "sdi_id" text;
--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN IF NOT EXISTS "sdi_message" text;
--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN IF NOT EXISTS "sdi_sent_at" timestamp;
--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN IF NOT EXISTS "sdi_status_at" timestamp;
--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN IF NOT EXISTS "sdi_checked_at" timestamp;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoice_sdi_open_idx" ON "invoice" ("sdi_status") WHERE "sdi_status" IN ('pending', 'delivered');
