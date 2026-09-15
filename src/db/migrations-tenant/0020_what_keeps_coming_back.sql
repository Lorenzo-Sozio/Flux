-- Contracts: recurring agreements, their terms and their renewals.
--
-- ⚠️ No status for "expired" or "renewal due": those change with the calendar and
-- are computed from the dates (src/lib/contract-terms.ts). `status` holds only a
-- person's decision — draft, active, cancelled.
--
-- Additive and re-runnable, as every tenant migration has to be.
CREATE TABLE IF NOT EXISTS "contract" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"company_id" text REFERENCES "company"("id") ON DELETE SET NULL,
	"contact_id" text REFERENCES "contact"("id") ON DELETE SET NULL,
	"deal_id" text REFERENCES "deal"("id") ON DELETE SET NULL,
	"owner_id" text REFERENCES "user"("id") ON DELETE SET NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"billing_period" text DEFAULT 'annual' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"auto_renew" boolean DEFAULT false NOT NULL,
	"renewal_term_months" integer,
	"notice_days" integer DEFAULT 30 NOT NULL,
	-- The term end whose renewal notice has been sent; see the daily job.
	"notice_sent_for" date,
	"notes" text,
	"cancelled_at" timestamp,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contract_company_id_idx" ON "contract" ("company_id");
