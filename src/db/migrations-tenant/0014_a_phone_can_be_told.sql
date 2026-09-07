-- A phone can be told, and a person can decide what it is told about.
--
-- Until now a notification existed only inside the application: the bell polled
-- every thirty seconds while a tab was in front of someone, every five minutes
-- while it was not, and never at all once the tab was closed. So an SLA breach at
-- three in the morning was written faithfully and reached nobody.
--
-- Two tables. `push_subscription` is per browser installation, not per person:
-- a phone and a laptop are two rows, and the same phone reinstalled is a third,
-- because the browser mints a new endpoint and abandons the old one. The endpoint
-- is unique so re-subscribing updates the row that exists rather than adding a
-- duplicate that delivers the same notification twice.
--
-- `notification_preference` holds one row per person, and only for people who
-- have actually changed something — no row means no choices made, which lands on
-- the defaults in src/lib/push-types.ts. `overrides` is JSON holding only the
-- switches that were touched, so adding a thirteenth notification type later
-- does not arrive silently switched off for everyone who ever opened the screen.
--
-- Additive and re-runnable, as every tenant migration has to be: the Neon HTTP
-- driver holds no session, so a migration that fails halfway leaves the statements
-- before it applied and records nothing. The foreign keys are declared inside the
-- CREATE, which the IF NOT EXISTS already guards, rather than as separate ALTERs
-- that would each need their own guard.
CREATE TABLE IF NOT EXISTS "push_subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_success_at" timestamp,
	CONSTRAINT "push_subscription_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_preference" (
	"user_id" text PRIMARY KEY NOT NULL REFERENCES "user"("id") ON DELETE cascade,
	"push_enabled" boolean DEFAULT true NOT NULL,
	"overrides" text DEFAULT '{}' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Every send starts from "which devices does this person have", so that lookup
-- gets an index rather than a scan of every subscription in the workspace.
CREATE INDEX IF NOT EXISTS "push_subscription_user_id_idx" ON "push_subscription" ("user_id");
