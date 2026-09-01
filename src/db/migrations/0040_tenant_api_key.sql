-- Per-tenant API key: bind the credential to the tenant instead of trusting a header.
--
-- Before this, a single global IMPORT_API_KEY authorised machine-to-machine writes, and
-- the tenant was taken from the X-Tenant-ID header — checked only for existence, never
-- bound to the caller. Whoever held the key could therefore write into ANY tenant's
-- database by changing one header, with role "editor".
--
-- Only the SHA-256 of the key is stored. The key itself is shown once when minted and
-- cannot be recovered: a credential a support ticket can read back is a credential that
-- leaks through the support ticket.
--
-- Nullable on purpose. A tenant without a key simply has no machine-to-machine access,
-- which is the safe state for every tenant that exists today. Keys are minted one at a
-- time with scripts/mint-tenant-api-key.ts. The global IMPORT_API_KEY keeps working as a
-- platform key and stays the only credential allowed to name a tenant in the header.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "api_key_hash" text;

-- UNIQUE, not just indexed: two tenants sharing a key hash would make the lookup
-- ambiguous, and "whichever row comes first" is not an isolation rule.
CREATE UNIQUE INDEX IF NOT EXISTS "tenants_api_key_hash_unique"
  ON "tenants" ("api_key_hash")
  WHERE "api_key_hash" IS NOT NULL;
