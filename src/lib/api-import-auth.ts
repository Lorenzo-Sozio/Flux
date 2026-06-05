import { timingSafeEqual } from "node:crypto";

import { auth } from "@/auth";
import { getTenantById } from "@/lib/get-tenant";

export interface ApiAuthResult {
  via: "session" | "apikey";
  userId: string | null;
  role: string;
  /**
   * Resolved tenant ID for the request.
   * - Session-based requests: taken from the JWT activeTenantId (set by middleware).
   * - API-key requests: validated from the X-Tenant-ID request header.
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

    return null;
  }

  const session = await auth();
  if (!session?.user?.id) return null;

  const role = (session.user as { role?: string }).role ?? "viewer";
  if (role === "viewer") return null;

  // For session-based calls, the middleware already injects x-tenant-id from the
  // JWT.  We read it from the request headers (which are Next.js's internal
  // request, not client-supplied) — already validated by the middleware.
  const tenantId = req.headers.get("x-tenant-id") ?? null;

  return { via: "session", userId: session.user.id, role, tenantId };
}
