import { type NextRequest, NextResponse } from "next/server";

import { createTenantDb } from "@/db";
import { activities } from "@/db/schema";
import { claim, hashBody, release, remember } from "@/lib/api-idempotency";
import { authenticateApiRequest } from "@/lib/api-import-auth";
import { checkAndTrackApiCall, EntitlementError } from "@/lib/billing/usage";
import { findByContactPoint, readContactPoint, whereToNote } from "@/lib/contact-point";
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

  // Counts the call against the plan, like every other /api/crm route. Opt-out and
  // erasure are deliberately excluded: refusing either because a plan limit was reached
  // means carrying on contacting somebody who asked you to stop, and missing a deadline
  // that is not ours to move.
  try {
    await checkAndTrackApiCall(authResult.tenantId);
  } catch (err) {
    if (err instanceof EntitlementError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    throw err;
  }
  let body: unknown;
  let rawBody = "";
  try {
    // Read as text and parsed here, so the hash below covers exactly the bytes
    // the caller sent: re-serialising a parsed object would make two identical
    // requests hash differently over nothing but key order.
    rawBody = await req.text();
    body = JSON.parse(rawBody);
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

  // The raw string from the request, and the pair it parses into, are two
  // different things and need two names.
  let parsed: { email: string | null; digits: string | null };
  try {
    parsed = readContactPoint(contactPoint);
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

  // ── The same request twice ──────────────────────────────────────────────────
  //
  // A caller whose response never arrived does not know whether this landed, and
  // sending it again creates a second copy of whatever this route cannot match
  // on. A key makes that retry safe. No key, and nothing changes.
  const idempotency = await claim(db, "/api/crm/notes", req.headers.get("Idempotency-Key"), await hashBody(rawBody));
  if (idempotency.kind === "replay") {
    return NextResponse.json(idempotency.body, { headers: { "Idempotent-Replay": "true" } });
  }
  if (idempotency.kind === "in-flight") {
    return NextResponse.json(
      { error: "A request with this Idempotency-Key is still running. Retry in a moment." },
      { status: 409 },
    );
  }
  if (idempotency.kind === "mismatch") {
    return NextResponse.json(
      { error: "This Idempotency-Key was already used with a different request body." },
      { status: 422 },
    );
  }

  // ⚠️ Every exit goes through here. A success is remembered, so a repeat
  // replays it; anything else releases the key, so a caller who corrects
  // their request may send it again under the same one. Without the release
  // a rejected request would hold its key for the whole stale window.
  let response: Response;
  try {
    response = await (async () => {
      const dove = whereToNote(await findByContactPoint(db, parsed.email, parsed.digits));
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
    })();
  } catch (error) {
    await release(db, idempotency);
    throw error;
  }

  if (response.ok) {
    try {
      await remember(db, idempotency, await response.clone().json());
    } catch {
      // An answer we cannot read back is an answer we cannot replay. The
      // import happened; leaving the key held would only refuse the retry.
      await release(db, idempotency);
    }
  } else {
    await release(db, idempotency);
  }

  return response;
}
