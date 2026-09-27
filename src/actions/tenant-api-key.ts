"use server";

import { revalidatePath } from "next/cache";

import { and, desc, eq, isNull } from "drizzle-orm";

import { platformDb } from "@/db";
import { apiKeys, tenants, users, webhooks } from "@/db/schema";
import { newScopedKey } from "@/lib/api-keys";
import { cleanScopes } from "@/lib/api-scopes";
import { requireAdminAccess, requireCapability } from "@/lib/auth-guard";
import { type Refusal, refuse } from "@/lib/i18n-message";
import { getCurrentTenantId, getDb } from "@/lib/tenant-context";

/**
 * The machine-to-machine keys of **this** tenant: scoped keys made, listed and revoked here,
 * and the single unscoped key from before scopes, which can still be seen and revoked but
 * no longer made — a new key says what it may do (src/lib/api-scopes.ts).
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
 * screen share. Rotating is making a new key and revoking the old one once the integration
 * has moved.
 */
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

// ─── Scoped keys (L9, decision D7) ────────────────────────────────────────────

export interface ApiKeyRow {
  id: string;
  name: string;
  hint: string;
  scopes: string[];
  createdAt: Date;
  lastUsedAt: Date | null;
  createdBy: string | null;
}

/** This workspace's live keys, newest first. Never the key: it is not stored. */
export async function listApiKeys(): Promise<ApiKeyRow[]> {
  await requireAdminAccess();
  const db = await getDb();
  return db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      hint: apiKeys.hint,
      scopes: apiKeys.scopes,
      createdAt: apiKeys.createdAt,
      lastUsedAt: apiKeys.lastUsedAt,
      createdBy: users.name,
    })
    .from(apiKeys)
    .leftJoin(users, eq(users.id, apiKeys.createdBy))
    .where(isNull(apiKeys.revokedAt))
    .orderBy(desc(apiKeys.createdAt));
}

/**
 * A new key, with a name and exactly the scopes chosen. Returned once.
 *
 * ⚠️⚠️ The workspace comes from the session, like everything here: a key minted for a
 * workspace passed as an argument is the cross-tenant defect `0040` closed.
 */
export async function createApiKeyAction(input: {
  name: string;
  scopes: string[];
}): Promise<{ ok: true; key: string } | Refusal> {
  const actor = await requireCapability("settings:manage");
  const tenantId = await getCurrentTenantId();
  if (!tenantId) throw new Error("No tenant in context");
  const name = String(input.name ?? "")
    .trim()
    .slice(0, 80);
  if (!name) return refuse("validation.apiKeys.nameRequired");
  const scopes = cleanScopes(input.scopes);
  // A key that may do nothing is a key somebody will "fix" by pasting it everywhere.
  if (scopes.length === 0) return refuse("validation.apiKeys.scopesRequired");
  const { key, hash, hint } = newScopedKey(tenantId);
  const db = await getDb();
  await db.insert(apiKeys).values({ name, hash, hint, scopes, createdBy: actor.userId });
  revalidatePath("/dashboard/settings/api");
  return { ok: true, key };
}

/** Revoked now: the next call with it is a 401. Kept as a row, so the log still has a name. */
export async function revokeApiKeyAction(id: string): Promise<{ ok: true }> {
  await requireAdminAccess();
  const db = await getDb();
  await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)));
  // ⚠️⚠️ And what it subscribed stops too: a leaked key's event stream must end with the key,
  // not keep delivering every event, signed, to whoever held it.
  await db
    .update(webhooks)
    .set({ isActive: false })
    .where(and(eq(webhooks.apiKeyId, id), isNull(webhooks.ownerId)));
  revalidatePath("/dashboard/settings/api");
  return { ok: true };
}
