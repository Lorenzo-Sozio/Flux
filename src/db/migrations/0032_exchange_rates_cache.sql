-- Exchange rates cache table (single-row, keyed by base currency "eur")
CREATE TABLE IF NOT EXISTS "exchange_rates_cache" (
  "id" text PRIMARY KEY NOT NULL DEFAULT 'eur',
  "rates" text NOT NULL,
  "fetched_at" timestamp DEFAULT now() NOT NULL
);

-- Change deal.currency default from USD to EUR (amounts are now stored in EUR)
ALTER TABLE "deal" ALTER COLUMN "currency" SET DEFAULT 'EUR';

-- Change quote.currency default from USD to EUR
ALTER TABLE "quote" ALTER COLUMN "currency" SET DEFAULT 'EUR';
