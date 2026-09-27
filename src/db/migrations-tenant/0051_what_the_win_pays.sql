-- Commissions (L8, decision D6): they accrue on the won deal.
--
-- A rule is a rate from a day, for one person or everyone, in one pipeline or all of them;
-- a change is a new rule from a later day, so the past keeps the rate it was earned at.
-- Approving a month freezes its lines: what was paid does not move when a deal is edited,
-- reopened or deleted afterwards, and the report says when that happened instead.
--
-- Additive and re-runnable, like every tenant migration.
CREATE TABLE IF NOT EXISTS "commission_rule" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text REFERENCES "user"("id") ON DELETE CASCADE,
	"pipeline_id" text REFERENCES "pipeline"("id") ON DELETE CASCADE,
	"rate_percent" numeric(5, 2) NOT NULL,
	"valid_from" text NOT NULL,
	"created_by" text REFERENCES "user"("id") ON DELETE SET NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "commission_rule_scope_from" ON "commission_rule" (coalesce("user_id", ''), coalesce("pipeline_id", ''), "valid_from");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "commission_statement" (
	"id" text PRIMARY KEY NOT NULL,
	"period" text NOT NULL,
	"approved_by" text REFERENCES "user"("id") ON DELETE SET NULL,
	"approved_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "commission_statement_period" ON "commission_statement" ("period");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "commission_line" (
	"id" text PRIMARY KEY NOT NULL,
	"statement_id" text NOT NULL REFERENCES "commission_statement"("id") ON DELETE CASCADE,
	"deal_id" text REFERENCES "deal"("id") ON DELETE SET NULL,
	"deal_name" text NOT NULL,
	"user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
	"rule_id" text,
	"won_at" timestamp NOT NULL,
	"base" numeric(12, 2) NOT NULL,
	"rate_percent" numeric(5, 2),
	"amount" numeric(12, 2) NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "commission_line_deal" ON "commission_line" ("deal_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "commission_line_statement" ON "commission_line" ("statement_id");
