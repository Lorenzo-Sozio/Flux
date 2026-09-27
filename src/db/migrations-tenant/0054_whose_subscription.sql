-- Which API key made a webhook subscription (security review of 27 September 2026).
--
-- A subscription made through `POST /api/crm/webhooks` carried no trace of the key that made
-- it, so revoking a leaked key left its subscriptions delivering every event, signed, to
-- whoever held it — and any key could delete another integration's subscriptions. Rows made
-- before this column stay unattributed; nothing can say which key made them.
--
-- Additive and re-runnable, like every tenant migration.
ALTER TABLE "webhook" ADD COLUMN IF NOT EXISTS "api_key_id" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_api_key_idx" ON "webhook" ("api_key_id");
