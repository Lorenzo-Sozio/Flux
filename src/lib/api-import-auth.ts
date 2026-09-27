import { NextResponse } from "next/server";

import { createHash, timingSafeEqual } from "node:crypto";

import { auth } from "@/auth";
import { createTenantDb } from "@/db";
import { findScopedKey, workspaceOfKey } from "@/lib/api-keys";
import { type ApiAccess, type ApiEntity, type ApiScope, grants, scopeName, WRITE_ALL } from "@/lib/api-scopes";
import { CLAIMED_TENANT_HEADER } from "@/lib/claimed-tenant";
import { getTenantByApiKeyHash, getTenantById } from "@/lib/get-tenant";
import { type Capability, can, isPlatformStaffRole, normalizeTenantRole } from "@/lib/permissions";
import { decryptDbUrl } from "@/lib/tenant-db";
import type { OriginKey } from "@/lib/webhook-envelope";

export interface ApiAuthResult {
  via: "session" | "apikey";
  userId: string | null;
  role: string;
  /**
   * Resolved tenant ID for the request.
   * - Session-based requests: taken from the JWT activeTenantId (set by middleware).
   * - Per-tenant API keys: resolved FROM THE KEY. The X-Tenant-ID header is not
   *   consulted, and a header naming a different tenant is refused rather than ignored.
   * - The platform API key (IMPORT_API_KEY): validated from the X-Tenant-ID header. It is
   *   the only credential allowed to name a tenant, and it can name any of them.
   * Null when called outside a tenant context (e.g., platform-level operations).
   */
  tenantId: string | null;
  /**
   * What a key may do, entity by entity (src/lib/api-scopes.ts). Null for a session: a
   * person is judged by their workspace role, the way the dashboard judges them.
   */
  scopes: readonly string[] | null;
  /** The key that was used, named — null for a session. Carried into every event's origin. */
  key: OriginKey | null;
}

/**
 * The workspace a machine caller names with `X-Tenant-ID`, as the proxy passed it on: the
 * proxy strips `x-tenant-id` itself (only its own may reach a route), and keeps the claim
 * here. A claim, never a credential — it is checked against the key every time.
 */
function claimedTenant(req: Request): string | null {
  // Never `x-tenant-id` itself: for a signed-in browser that is the proxy's own, the
  // session's workspace, and reading it as a claim would refuse the key's own workspace.
  return req.headers.get(CLAIMED_TENANT_HEADER)?.trim() || null;
}

const PLATFORM_KEY: OriginKey = { id: "platform", name: "IMPORT_API_KEY" };
const LEGACY_KEY: OriginKey = { id: "legacy", name: "Workspace key (before scopes)" };

/**
 * Who is calling. `access` decides what a session must be able to do — `record:write` to
 * write, `record:read` to read; a key's own scopes are checked by `gateApiRequest`.
 * Routes call the gate, never this: a route that only authenticates lets any valid key do
 * anything.
 */
export async function authenticateApiRequest(req: Request, access: ApiAccess = "write"): Promise<ApiAuthResult | null> {
  const authHeader = req.headers.get("authorization");

  if (authHeader?.startsWith("Bearer ")) {
    const provided = authHeader.slice(7).trim();
    const apiKey = process.env.IMPORT_API_KEY?.trim();

    if (apiKey && provided) {
      try {
        const a = Buffer.from(provided);
        const b = Buffer.from(apiKey);
        if (a.length === b.length && timingSafeEqual(a, b)) {
          // API-key callers must supply X-Tenant-ID so we can route to the
          // correct per-tenant database.  Validate it against the tenant registry
          // to prevent forging an arbitrary tenant ID.
          const rawTenantId = claimedTenant(req);
          let tenantId: string | null = null;
          if (rawTenantId) {
            const tenant = await getTenantById(rawTenantId);
            tenantId = tenant?.id ?? null;
          }
          return { via: "apikey", userId: null, role: "editor", tenantId, scopes: WRITE_ALL, key: PLATFORM_KEY };
        }
      } catch (_err) {
        // ignore buffer/comparison errors
      }
    }

    // A scoped key names its workspace; the key is then looked up in that workspace's own
    // database, and must be there, unrevoked, with this exact value.
    const named = provided ? workspaceOfKey(provided) : null;
    if (named) {
      const tenant = await getTenantById(named);
      if (!tenant) return null;
      const found = await findScopedKey(createTenantDb(tenant.id, decryptDbUrl(tenant.dbUrl)), provided).catch(
        () => null,
      );
      if (!found) return null;
      const claimed = claimedTenant(req);
      if (claimed && claimed !== tenant.id) return null;
      return {
        via: "apikey",
        userId: null,
        role: "editor",
        tenantId: tenant.id,
        scopes: found.scopes,
        key: { id: found.id, name: found.name },
      };
    }

    // Not the platform key. It may still be a tenant's own key: the tenant is then a
    // property of the credential, which is the whole point of this branch.
    if (provided) {
      const hash = createHash("sha256").update(provided).digest("hex");
      const tenant = await getTenantByApiKeyHash(hash);
      if (tenant) {
        // A header that disagrees with the key is refused, not ignored. Ignoring it would
        // let a misconfigured integration write happily into its own tenant while its
        // operator believes it is writing into another one — and nobody would find out
        // until the wrong customer got a message.
        const claimed = claimedTenant(req);
        if (claimed && claimed !== tenant.id) return null;
        // Made before scopes: it keeps what it could do — write everything, read nothing.
        return { via: "apikey", userId: null, role: "editor", tenantId: tenant.id, scopes: WRITE_ALL, key: LEGACY_KEY };
      }
    }

    return null;
  }

  const session = await auth();
  if (!session?.user?.id) return null;

  // ⚠️⚠️ The **workspace** role decides this, not `session.user.role`.
  //
  // `session.user.role` is Flux's own staff scale and reads "user" for every
  // customer who has ever signed in — so `role === "viewer"` was never true for
  // anybody outside Flux, and a workspace member marked read-only could create
  // contacts, leads, companies, activities, notes and orders through this API,
  // and trigger erasure and opt-out with them. `viewer` is read-only everywhere,
  // and everywhere includes here. See the two role scales in CLAUDE.md.
  //
  // Asked as a capability rather than compared as a string, so it cannot drift
  // from what the dashboard allows the same person to do.
  const user = session.user as { role?: string | null; tenantRole?: string | null };
  const actor = {
    userId: session.user.id,
    tenantRole: normalizeTenantRole(user.tenantRole),
    isPlatformStaff: isPlatformStaffRole(user.role),
  };
  if (access === "read" ? !can(actor, "record:read") : !can(actor, "record:write")) return null;

  const role = actor.tenantRole;

  // For session-based calls, the middleware already injects x-tenant-id from the
  // JWT.  We read it from the request headers (which are Next.js's internal
  // request, not client-supplied) — already validated by the middleware.
  const tenantId = req.headers.get("x-tenant-id") ?? null;

  return { via: "session", userId: session.user.id, role, tenantId, scopes: null, key: null };
}

/**
 * The door of every `/api/crm` route: who is calling (401 when nobody), and whether what
 * they hold covers this route (403, naming the scope, when it does not).
 *
 * ⚠️⚠️ The scope is a required argument, so a route cannot be written without saying
 * what it touches — and `api-scopes.inventory.test.ts` checks each route names the right
 * one. A 403 says which scope was missing: an integrator can fix that, while a bare 401
 * would send them to regenerate a key that was fine.
 */
/**
 * ⚠️⚠️ What a **signed-in person** must be able to do in the dashboard to do the same here.
 * A session carries no scopes, and `record:write` alone let an editor subscribe a URL to
 * every event with the workspace's signing secret, or erase a person — both admin-only on
 * the screens. An entity not listed needs only what `authenticateApiRequest` already asked.
 */
const SESSION_NEEDS: Partial<Record<ApiEntity, Capability>> = {
  webhooks: "webhook:manage",
  privacy: "privacy:manage",
  quotes: "quote:write",
  orders: "order:write",
};

export async function gateApiRequest(
  req: Request,
  need: ApiScope,
): Promise<{ auth: ApiAuthResult; response?: never } | { auth?: never; response: NextResponse }> {
  const who = await authenticateApiRequest(req, need.access);
  if (!who) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const sessionNeeds = need.access === "write" ? SESSION_NEEDS[need.entity] : undefined;
  if (who.via === "session" && sessionNeeds && !can(who.role, sessionNeeds)) {
    return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  if (who.scopes && !grants(who.scopes, need)) {
    return {
      response: NextResponse.json(
        { error: "This API key does not cover this request.", scope: scopeName(need) },
        { status: 403 },
      ),
    };
  }
  return { auth: who };
}
