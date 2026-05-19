-- Platform-level distributed rate limiter table.
-- Used by src/lib/rate-limiter.ts to enforce per-key limits across all instances.
-- Rows can be pruned at any time: DELETE FROM ratelimit_entry WHERE reset_at < NOW();

CREATE TABLE IF NOT EXISTS "ratelimit_entry" (
  "key"        text        PRIMARY KEY NOT NULL,
  "count"      integer     NOT NULL DEFAULT 1,
  "reset_at"   timestamp   NOT NULL,
  "updated_at" timestamp   NOT NULL DEFAULT now()
);
