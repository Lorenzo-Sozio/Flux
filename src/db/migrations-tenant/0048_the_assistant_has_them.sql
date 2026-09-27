-- «Seguito dall'assistente» (V3.1 F3, decision D-A): a person an AI assistant is working with,
-- marked through the API, so Flux's own sequences and campaigns leave them alone instead of
-- writing to them a second time, and the people in Flux can see it.
--
-- Additive and re-runnable, like every tenant migration.
ALTER TABLE "lead" ADD COLUMN IF NOT EXISTS "assistant_since" timestamp;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN IF NOT EXISTS "assistant_name" text;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "assistant_since" timestamp;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "assistant_name" text;
