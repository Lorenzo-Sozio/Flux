-- The progressive of the file an invoice is sent to SDI as, for invoices in a series other than
-- the main one. Their name used to be built from the series and the number and then cut to five
-- characters, which cut exactly the digits telling two invoices apart: invoices 12/B and 13/B had
-- the same file name, and SDI refuses a name it has already received. The progressive comes from
-- a counter of the workspace, taken by the statement that issues the invoice.
--
-- Additive and re-runnable, like every tenant migration.
ALTER TABLE "invoice" ADD COLUMN IF NOT EXISTS "sdi_progressive" integer;
