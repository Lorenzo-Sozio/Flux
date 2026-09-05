import { createHash, timingSafeEqual } from "node:crypto";

import { auth } from "@/auth";
import { getTenantByApiKeyHash, getTenantById } from "@/lib/get-tenant";
import { can, isPlatformStaffRole, normalizeTenantRole } from "@/lib/permissions";

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
}

export async function authenticateApiRequest(req: Request): Promise<ApiAuthResult | null> {
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
          const rawTenantId = req.headers.get("x-tenant-id")?.trim() ?? null;
          let tenantId: string | null = null;
          if (rawTenantId) {
            const tenant = await getTenantById(rawTenantId);
            tenantId = tenant?.id ?? null;
          }
          return { via: "apikey", userId: null, role: "editor", tenantId };
        }
      } catch (_err) {
        // ignore buffer/comparison errors
      }
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
        const claimed = req.headers.get("x-tenant-id")?.trim();
        if (claimed && claimed !== tenant.id) return null;
        return { via: "apikey", userId: null, role: "editor", tenantId: tenant.id };
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
  if (!can(actor, "record:write")) return null;

  const role = actor.tenantRole;

  // For session-based calls, the middleware already injects x-tenant-id from the
  // JWT.  We read it from the request headers (which are Next.js's internal
  // request, not client-supplied) — already validated by the middleware.
  const tenantId = req.headers.get("x-tenant-id") ?? null;

  return { via: "session", userId: session.user.id, role, tenantId };
}
