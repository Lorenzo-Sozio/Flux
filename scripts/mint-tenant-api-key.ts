/**
 * Mints a machine-to-machine API key for ONE tenant.
 *
 *   npx tsx scripts/mint-tenant-api-key.ts <tenantId|subdomain>
 *   npx tsx scripts/mint-tenant-api-key.ts <tenantId|subdomain> --revoke
 *
 * The key is printed once and never stored: only its SHA-256 lands in
 * tenants.api_key_hash. A credential that can be read back later is a credential that
 * leaks through whatever can read it back — a support ticket, a backup, a screen share.
 *
 * Why this exists at all: machine-to-machine writes used to be authorised by a single
 * global IMPORT_API_KEY, with the target tenant taken from the X-Tenant-ID header. The
 * header was validated for existence, never bound to the caller, so one key could write
 * into every tenant's database. With a per-tenant key the tenant is a property of the
 * credential instead of a claim of the request.
 *
 * The global IMPORT_API_KEY still works and stays the platform key: it remains the only
 * credential allowed to name a tenant in the header, and it can name any of them. Keep it
 * where a platform operator can use it and nowhere else.
 */
import { createHash, randomBytes } from "node:crypto";

import { config } from "dotenv";
import { eq, or } from "drizzle-orm";

config({ path: ".env" });
config({ path: ".env.local", override: true });

async function main() {
  const [target, ...flags] = process.argv.slice(2);
  if (!target) {
    console.error("usage: npx tsx scripts/mint-tenant-api-key.ts <tenantId|subdomain> [--revoke]");
    process.exit(1);
  }
  const revoke = flags.includes("--revoke");

  const { platformDb } = await import("../src/db");
  const { tenants } = await import("../src/db/schema");

  const tenant = await platformDb.query.tenants.findFirst({
    where: or(eq(tenants.id, target), eq(tenants.subdomain, target)),
  });
  if (!tenant) {
    console.error(`no tenant matches ${JSON.stringify(target)} by id or subdomain`);
    process.exit(1);
  }

  if (revoke) {
    await platformDb.update(tenants).set({ apiKeyHash: null }).where(eq(tenants.id, tenant.id));
    console.log(`revoked the API key of ${tenant.name} (${tenant.subdomain}).`);
    console.log("Machine-to-machine calls with that key now get 401 on the next request:");
    console.log("the lookup is deliberately uncached, so revocation is immediate.");
    return;
  }

  // 32 bytes of CSPRNG. The `flx_` prefix is not decoration: it lets a key be recognised
  // on sight in a log or a paste, which is what makes an accidental disclosure something
  // someone reports instead of something nobody notices.
  const key = `flx_${randomBytes(32).toString("hex")}`;
  const hash = createHash("sha256").update(key).digest("hex");

  await platformDb.update(tenants).set({ apiKeyHash: hash }).where(eq(tenants.id, tenant.id));

  console.log(`Tenant : ${tenant.name} (${tenant.subdomain})`);
  console.log(`Id     : ${tenant.id}`);
  console.log(`API key: ${key}`);
  console.log("");
  console.log("Shown once — it is not stored and cannot be recovered. Minting again");
  console.log("replaces it, which is also how you rotate one.");
  console.log("");
  console.log("The caller does NOT send X-Tenant-ID: the tenant comes from the key, and a");
  console.log("header naming a different tenant is refused.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
