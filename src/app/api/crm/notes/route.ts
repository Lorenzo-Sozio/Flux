import { type NextRequest, NextResponse } from "next/server";

import { createTenantDb } from "@/db";
import { activities } from "@/db/schema";
import { authenticateApiRequest } from "@/lib/api-import-auth";
import { doveAnnotare, leggiRecapito, trova } from "@/lib/contact-point";
import { getTenantById } from "@/lib/get-tenant";
import { decryptDbUrl } from "@/lib/tenant-db";

/**
 * Write down, on the person's own timeline, something an integration did.
 *
 * Body: `{ "contactPoint": "+39 333 111 2223", "text": "…", "occurredAt": "…" }`.
 *
 * ⚠️⚠️ **It starts from a contact point, not from an id**, like the erasure does and for the
 * same reason: the caller's id for this person means nothing here. The generic activities
 * endpoint takes ids, so it cannot be used by anything that only knows how to reach
 * someone.
 *
 * ⚠️ **Nobody found is a 404, not a silent success.** An assistant that believes it has
 * recorded what it did, on a timeline that does not exist, is worse than one that knows it
 * could not: the note is the only trace, and a lost trace is invisible by definition.
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
  const text = typeof dati.text === "string" ? dati.text.trim() : "";
  if (!contactPoint || !text) {
    return NextResponse.json(
      {
        error: "Validation failed",
        errors: [
          ...(contactPoint ? [] : [{ field: "contactPoint", message: "contactPoint is required" }]),
          ...(text ? [] : [{ field: "text", message: "text is required" }]),
        ],
      },
      { status: 422 },
    );
  }
  // ⚠️ The column holds 5000; a longer note would be truncated by the database and read as
  // a sentence that stops mid-word. Refusing says which one was too long.
  if (text.length > 5000) {
    return NextResponse.json(
      { error: "Validation failed", errors: [{ field: "text", message: "text is too long" }] },
      { status: 422 },
    );
  }

  let recapito: { email: string | null; digits: string | null };
  try {
    recapito = leggiRecapito(contactPoint);
  } catch (_err) {
    return NextResponse.json(
      {
        error: "Validation failed",
        errors: [{ field: "contactPoint", message: "must be an email address or a phone number" }],
      },
      { status: 422 },
    );
  }

  const tenant = await getTenantById(authResult.tenantId);
  if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  const db = createTenantDb(tenant.id, decryptDbUrl(tenant.dbUrl));

  const dove = doveAnnotare(await trova(db, recapito.email, recapito.digits));
  if (!dove) {
    return NextResponse.json({ error: "No person reachable at that contact point" }, { status: 404 });
  }

  const occurredAt =
    typeof dati.occurredAt === "string" && !Number.isNaN(Date.parse(dati.occurredAt))
      ? new Date(dati.occurredAt)
      : new Date();

  const [created] = await db
    .insert(activities)
    .values({ type: "note", content: text, date: occurredAt, ...dove })
    .returning();

  // ⚠️ No webhook here, deliberately. This note exists because an integration told us what
  // it did: announcing it back would hand that integration its own event, and one that
  // filters its own writes would drop it while one that does not would loop.
  return NextResponse.json({ status: "created", id: created.id }, { status: 201 });
}
