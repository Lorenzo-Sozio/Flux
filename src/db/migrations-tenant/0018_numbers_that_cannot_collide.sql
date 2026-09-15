-- A counter per numbering sequence, advanced in one statement.
--
-- Order numbers were derived from `max(order_number)` of the current year. Two
-- defects came with that, and neither needed bad luck to happen:
--
--   * Two orders created at the same moment read the same maximum and computed
--     the same next number. The unique constraint refused the second, so somebody
--     saw their order fail to save.
--   * `max()` on text compares character by character, and "ORD-2026-10000" sorts
--     *below* "ORD-2026-9999". Past the nine-thousand-nine-hundred-and-ninety-ninth
--     order of a year the maximum stops moving, the next number is always 10000,
--     and every order after the first one at that size fails for the rest of the
--     year.
--
-- `INSERT … ON CONFLICT DO UPDATE SET last_value = last_value + 1 RETURNING` is a
-- single statement, and a single statement is atomic in Postgres with or without a
-- transaction: the row lock on the conflicting row serialises concurrent callers.
-- The Neon HTTP driver holds no session, so one statement is the only kind of
-- atomic this code gets.
--
-- Additive and re-runnable, as every tenant migration has to be. The counter
-- seeds itself from the numbers already issued the first time a scope is used, so
-- there is no backfill here and nothing to get wrong in one.
CREATE TABLE IF NOT EXISTS "document_counter" (
	"scope" text PRIMARY KEY NOT NULL,
	"last_value" integer NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
