import { type NextRequest, NextResponse } from "next/server";

import { createTenantDb } from "@/db";
import { authenticateApiRequest } from "@/lib/api-import-auth";
import { countByContactPoint, eraseByContactPoint } from "@/lib/erasure";
import { getTenantById } from "@/lib/get-tenant";
import { decryptDbUrl } from "@/lib/tenant-db";

/**
 * GDPR art. 17 — erase the person reachable at a contact point.
 *
 * Body: `{ "contactPoint": "+39 333 111 2223" }` or an email address.
 * Add `"preview": true` to count without erasing.
 *
 * ⚠️ The response is a **report**, not an acknowledgement: it says what was deleted, what
 * was kept with the person removed from it, and what was deliberately left alone. Whoever
 * answers the person reads it, and «done» is not an answer they can give from a 200 alone.
 */
export async function POST(req: NextRequest) {
  const authResult = await authenticateApiRequest(req);
  if (!authResult) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!authResult.tenantId) {
    return NextResponse.json(
      { error: "Tenant context required. Supply X-Tenant-ID header with a valid tenant ID." },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch (_err) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const dati = (body ?? {}) as Record<string, unknown>;
  const contactPoint = typeof dati.contactPoint === "string" ? dati.contactPoint.trim() : "";
  if (!contactPoint) {
    return NextResponse.json(
      { error: "Validation failed", errors: [{ field: "contactPoint", message: "contactPoint is required" }] },
      { status: 422 },
    );
  }

  const tenant = await getTenantById(authResult.tenantId);
  if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  const db = createTenantDb(tenant.id, decryptDbUrl(tenant.dbUrl));

  try {
    if (dati.preview === true) {
      // ⚠️ No side effect at all, and the same predicates as the erasure: a preview built
      // from different conditions can describe an operation that will not happen.
      return NextResponse.json({ status: "preview", found: await countByContactPoint(db, contactPoint) });
    }
    return NextResponse.json({ status: "erased", report: await eraseByContactPoint(db, contactPoint) });
  } catch (err) {
    // ⚠️ A failure is reported as a failure. Answering 200 to an erasure that did not
    // happen is the one outcome that turns a technical problem into a false statement to
    // the person who asked to be forgotten.
    const message = err instanceof Error ? err.message : "erasure failed";
    const cliente = message.startsWith("a contact point must be") || message.startsWith("no contact point");
    return NextResponse.json({ error: message }, { status: cliente ? 422 : 500 });
  }
}
