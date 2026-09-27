-- A row of the work list put aside by the person it belongs to, until a date.
--
-- The list could only be worked by opening each record: nothing on it could be done or
-- put off from where it was, so a deal waiting on the customer's holidays sat at the top
-- every morning until it had to be ignored. A snooze is personal — one person's "not
-- today" hides nothing from anybody else.
--
-- Additive and re-runnable, like every tenant migration.
CREATE TABLE IF NOT EXISTS "next_action_snooze" (
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"entity_id" text NOT NULL,
	"until" timestamp NOT NULL,
	CONSTRAINT "next_action_snooze_pk" PRIMARY KEY ("user_id", "kind", "entity_id")
);
