-- The language a customer's documents are written in: quotes, their print view,
-- public page and email, and the courtesy copy of an invoice. Null means "from the
-- country", so existing customers need no backfill.
--
-- Additive and re-runnable, as every tenant migration has to be.
ALTER TABLE "company" ADD COLUMN IF NOT EXISTS "language" text;
