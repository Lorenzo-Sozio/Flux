-- A bank line that returns a payment (a direct debit or RiBa unpaid, CAMT RvslInd): it is money
-- going back the way it came, and it must not be ignored with the bank's charges.
--
-- Additive and re-runnable, like every tenant migration.
ALTER TABLE "bank_transaction" ADD COLUMN IF NOT EXISTS "reversal" boolean DEFAULT false NOT NULL;
