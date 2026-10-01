-- Who sees which customer (src/lib/record-visibility.ts).
--
-- A salesperson's list of companies asks, row by row, whether one of the company's contacts or
-- deals is theirs; a contact asks the same of its deals. Postgres runs those checks per row, and
-- with no index each one read the whole contact or deal table.
--
-- Additive and re-runnable, like every tenant migration.
CREATE INDEX IF NOT EXISTS "contact_company_idx" ON "contact" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deal_company_idx" ON "deal" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deal_contact_idx" ON "deal" USING btree ("contact_id");
