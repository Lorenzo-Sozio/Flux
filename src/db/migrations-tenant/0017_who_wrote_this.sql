-- Who wrote this: a person at a keyboard, or an integration with a key.
--
-- ## The question the CRM could not answer
--
-- Every write to /api/crm/* already knows the answer. `authenticateApiRequest` returns
-- `via: "session" | "apikey"` on every request, and nothing kept it: the row landed and the
-- caller was forgotten. So "what has the assistant been doing in my CRM" — which is the
-- question somebody asks before trusting an agent that writes into it — had no answer at
-- all, and the closest thing available was guesswork from an empty `owner_id`.
--
-- ⚠️⚠️ **And `source` is NOT that answer, which is how this table came to exist.** `source`
-- on lead, contact and company means *where the customer came from* — organic, referral,
-- a channel — and the assistant already writes the channel into it. A first attempt at the
-- report read provenance out of that column, which put two questions into one field: the
-- first caller to use it for its real meaning would have made the report lie.
--
-- ## One row per successful write, not per row written
--
-- A bulk import of five hundred contacts is one thing that happened, and `rows` says how
-- big it was. One log row per contact would bury the reader in the thing they are least
-- interested in, and make the table grow with the import instead of with the activity.
--
-- ⚠️ **Written only after the write succeeds.** Recording the attempt would count a
-- rejected batch among the things the assistant did, and a report that inflates what an
-- automation achieved is the one kind of error nobody in the company will catch.
--
-- ⚠️ `via` says person or integration and **not which** integration: an API key identifies
-- a tenant, not a caller. The screen says so rather than claiming more than the data does.
--
-- Sweeping old rows is a job for later, as for `api_idempotency`: a workspace writes one
-- row per API request, and the report reads a month at a time.
--
-- Additive and re-runnable, as every tenant migration has to be: the Neon HTTP driver
-- holds no session, so a migration that fails halfway leaves the statements before it
-- applied and records nothing.
CREATE TABLE IF NOT EXISTS "api_write_log" (
	"id" text PRIMARY KEY,
	-- What was written, in the CRM's own words: lead, contact, note, order… It is the
	-- grouping the report shows, so it is a word and not a table name.
	"entity" text NOT NULL,
	-- The route, kept beside the entity because two routes can write the same thing: a
	-- note on a lead and a note on a deal are both notes, and telling them apart is the
	-- difference between diagnosing an integration and guessing at it.
	"endpoint" text NOT NULL,
	-- The single record, when there was one. Null for a bulk request: an import writes
	-- many, and naming one of them would be arbitrary.
	"record_id" text,
	"rows" integer DEFAULT 1 NOT NULL,
	-- `session` or `apikey`.
	"via" text NOT NULL,
	-- The user, when a person did it. Null for an integration, which has no user.
	"actor" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- The only read this table serves: a period, newest first, grouped by what was written.
CREATE INDEX IF NOT EXISTS "api_write_log_created_at_idx" ON "api_write_log" ("created_at");
