import { type NextRequest, NextResponse } from "next/server";

import { eq, sql } from "drizzle-orm";

import { dispatchWebhook } from "@/actions/webhooks";
import { createTenantDb } from "@/db";
import { leads } from "@/db/schema";
import { claim, hashBody, release, remember } from "@/lib/api-idempotency";
import { authenticateApiRequest } from "@/lib/api-import-auth";
import { buildLeadPayload, digitsForMatching, parseOnDuplicate, validateLeadInput } from "@/lib/api-import-validators";
import { checkAndTrackApiCall, EntitlementError } from "@/lib/billing/usage";
import { getTenantById } from "@/lib/get-tenant";
import { decryptDbUrl } from "@/lib/tenant-db";

/**
 * ⚠️ Every event leaving this route declares that a **machine** caused it.
 *
 * That is the line which stops the echo at its source: an integration writes a lead here,
 * this CRM emits `lead.created`, and the integration receives it. Without knowing the
 * change is its own it reacts to itself — and does not stop.
 */
const API_ORIGIN = { via: "api" as const, actor: null };

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

  const { errors, data } = validateLeadInput(body);
  if (errors.length > 0 || !data) {
    return NextResponse.json({ error: "Validation failed", errors }, { status: 422 });
  }

  const onDuplicate = parseOnDuplicate(body as Record<string, unknown>);
  const tenant = await getTenantById(authResult.tenantId);
  if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  const db = createTenantDb(tenant.id, decryptDbUrl(tenant.dbUrl));

  // ── The same request twice ──────────────────────────────────────────────────
  //
  // A caller whose response never arrived does not know whether this landed, and
  // sending it again creates a second copy of whatever this route cannot match
  // on. A key makes that retry safe. No key, and nothing changes.
  const idempotency = await claim(db, "/api/crm/leads", req.headers.get("Idempotency-Key"), await hashBody(rawBody));
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
      // ⚠️ **Also by phone, and that is what makes a retry safe on a phone-only contact.**
      //
      // Matching on `email` alone meant that a lead who arrived by phone — which is most of
      // them, when the caller is a phone system — had nothing to be matched on: every retry of
      // the same request created another row. And the column is free text, so the same number
      // typed two ways was two people.
      //
      // The comparison strips everything that is not a digit on both sides. It is a scan today;
      // the day it needs to be fast, the same expression becomes an index. Correct first.
      const digits = digitsForMatching(data.phone);
      const criterio = data.email
        ? eq(leads.email, data.email)
        : digits
          ? sql`regexp_replace(coalesce(${leads.phone}, ''), '[^0-9]+', '', 'g') = ${digits}`
          : null;

      if (criterio) {
        const [existing] = await db.select({ id: leads.id }).from(leads).where(criterio);

        if (existing) {
          if (onDuplicate === "error") {
            return NextResponse.json(
              {
                error: "Conflict",
                reason: data.email ? "duplicate_email" : "duplicate_phone",
                existingId: existing.id,
              },
              { status: 409 },
            );
          }

          if (onDuplicate === "update") {
            const [updated] = await db
              .update(leads)
              .set(buildLeadPayload(data, authResult.userId))
              .where(eq(leads.id, existing.id))
              .returning();
            dispatchWebhook("lead.updated", { lead: updated }, API_ORIGIN, db);
            return NextResponse.json({ status: "updated", id: updated.id, data: updated });
          }

          return NextResponse.json({
            status: "skipped",
            reason: data.email ? "duplicate_email" : "duplicate_phone",
            existingId: existing.id,
          });
        }
      }

      const [created] = await db.insert(leads).values(buildLeadPayload(data, authResult.userId)).returning();
      dispatchWebhook("lead.created", { lead: created }, API_ORIGIN, db);

      return NextResponse.json({ status: "created", id: created.id, data: created }, { status: 201 });
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
