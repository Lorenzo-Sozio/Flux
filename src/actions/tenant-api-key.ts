"use server";

import { createHash, randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";

import { platformDb } from "@/db";
import { tenants } from "@/db/schema";
import { requireAdminAccess } from "@/lib/auth-guard";
import { getCurrentTenantId } from "@/lib/tenant-context";

/**
 * Mint, read the state of, and revoke the machine-to-machine key of **this** tenant.
 *
 * ## ⚠️⚠️ Why a screen, when a script already did it
 *
 * Because the script is a terminal, and the person who has to connect an integration is
 * the business owner. `scripts/mint-tenant-api-key.ts` stays — it is how a platform
 * operator mints a key for somebody else — but an owner who cannot obtain their own
 * credential from the product has an integration they cannot switch on, which is the same
 * defect as an integration that does not exist.
 *
 * ⚠️ It is **not a new security surface**: creating a webhook from this same settings area
 * already mints 32 bytes of CSPRNG and shows them. The guard is the same,
 * `settings:manage`.
 *
 * ## ⚠️⚠️ The tenant comes from the session, never from an argument
 *
 * A function that took a tenant id would let whoever can call it mint a key for somebody
 * else's tenant — the exact defect that `0040` exists to close, recreated one layer up.
 *
 * ## Shown once, and that is the point
 *
 * Only the SHA-256 lands in the column. A credential that can be read back later is a
 * credential that leaks through whatever can read it back: a support ticket, a backup, a
 * screen share. Minting again replaces the previous one, which is also how you rotate.
 */
export async function mintTenantApiKey(): Promise<{ key: string }> {
  await requireAdminAccess();
  const tenantId = await getCurrentTenantId();
  if (!tenantId) throw new Error("No tenant in context");

  // The `flx_` prefix is not decoration: it lets a key be recognised on sight in a log or
  // a paste, which is what makes an accidental disclosure something someone reports
  // instead of something nobody notices.
  const key = `flx_${randomBytes(32).toString("hex")}`;
  const hash = createHash("sha256").update(key).digest("hex");
  await platformDb.update(tenants).set({ apiKeyHash: hash }).where(eq(tenants.id, tenantId));
  return { key };
}

/** Whether a key exists, without ever returning it. */
export async function tenantApiKeyExists(): Promise<boolean> {
  await requireAdminAccess();
  const tenantId = await getCurrentTenantId();
  if (!tenantId) return false;
  const [row] = await platformDb.select({ hash: tenants.apiKeyHash }).from(tenants).where(eq(tenants.id, tenantId));
  return Boolean(row?.hash);
}

/**
 * Revoke it.
 *
 * ⚠️ Immediate: the lookup is deliberately uncached, so the next machine-to-machine call
 * with that key gets a 401. An integration that stops working right now is the point —
 * revoking something that keeps working for an hour is not revoking.
 */
export async function revokeTenantApiKey(): Promise<void> {
  await requireAdminAccess();
  const tenantId = await getCurrentTenantId();
  if (!tenantId) return;
  await platformDb.update(tenants).set({ apiKeyHash: null }).where(eq(tenants.id, tenantId));
}
