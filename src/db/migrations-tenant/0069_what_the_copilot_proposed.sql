-- What the AI copilot proposed, and what a person did with it (Fase 5, C0; src/lib/ai/run.ts).
--
-- One row per call, successful or not: the log of what reached the model, and the measure of
-- whether a proposal was accepted as it came, edited or discarded. The prompt is never stored;
-- the proposal's text is, and goes with the person in an erasure (src/lib/erasure.ts).
--
-- Additive and re-runnable, like every tenant migration.
CREATE TABLE IF NOT EXISTS "ai_suggestion" (
	"id" text PRIMARY KEY NOT NULL,
	"task" text NOT NULL,
	"user_id" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"provider" text,
	"model" text,
	"status" text NOT NULL,
	"failure_reason" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"reasoning_tokens" integer DEFAULT 0 NOT NULL,
	"text" text,
	"outcome" text DEFAULT 'pending' NOT NULL,
	"decided_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_suggestion_entity_idx" ON "ai_suggestion" USING btree ("entity_type","entity_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_suggestion_created_idx" ON "ai_suggestion" USING btree ("created_at");
