-- A quote accepted with a simple electronic signature (L2, decision D5): who typed their name,
-- the exact consent they ticked, when, from where, and the SHA-256 of the PDF as it was at that
-- moment — kept in object storage, so the fingerprint can be checked against the bytes.
--
-- Additive and re-runnable, like every tenant migration.
ALTER TABLE "quote" ADD COLUMN IF NOT EXISTS "signed_name" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN IF NOT EXISTS "signed_at" timestamp;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN IF NOT EXISTS "signed_ip" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN IF NOT EXISTS "signed_user_agent" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN IF NOT EXISTS "signed_consent" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN IF NOT EXISTS "signed_pdf_sha256" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN IF NOT EXISTS "signed_pdf_key" text;
