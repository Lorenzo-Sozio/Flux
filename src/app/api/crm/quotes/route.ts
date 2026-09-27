import { type NextRequest, NextResponse } from "next/server";

import { createTenantDb } from "@/db";
import { claim, hashBody, release, remember } from "@/lib/api-idempotency";
import { gateApiRequest } from "@/lib/api-import-auth";
import { logApiWrite } from "@/lib/api-write-log";
import { checkAndTrackApiCall, EntitlementError } from "@/lib/billing/usage";
import { getTenantById } from "@/lib/get-tenant";
import { notify } from "@/lib/notify";
import { draftQuote, readDraftInput } from "@/lib/quote-draft";
import { runWithTenant } from "@/lib/tenant-context";
import { decryptDbUrl } from "@/lib/tenant-db";

/**
 * The route's own name, written once: the idempotency ledger and the write log both
 * record it, and two literals that have to agree are one literal too many.
 */
const ENDPOINT = "/api/crm/quotes";

/** What a key must hold to call this (src/lib/api-scopes.ts). */
const SCOPE = { entity: "quotes", access: "write" } as const;

/**
 * A draft quote an integration proposes (src/lib/quote-draft.ts). Body:
 * `{ "dealId": "…", "lines": [{ "productId": "…", "quantity": 2, "note": "senza cipolla" }] }`.
 *
 * The prices are Flux's — the customer's price list over the catalogue — never the caller's.
 * The quote is a draft for the deal's owner, who is told; nothing reaches the customer until a
 * person sends it.
 */
export async function POST(req: NextRequest) {
  const gate = await gateApiRequest(req, SCOPE);
  if (gate.response) return gate.response;
  const authResult = gate.auth;

  if (!authResult.tenantId) {
    return NextResponse.json(
      { error: "Tenant context required. Supply X-Tenant-ID header with a valid tenant ID." },
      { status: 400 },
    );
  }
  try {
    await checkAndTrackApiCall(authResult.tenantId);
  } catch (err) {
    if (err instanceof EntitlementError) return NextResponse.json({ error: err.message }, { status: 429 });
    throw err;
  }

  let rawBody = "";
  let body: Record<string, unknown>;
  try {
    rawBody = await req.text();
    const parsed = JSON.parse(rawBody);
    body = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const input = readDraftInput(body);
  if (!input.ok) return NextResponse.json({ error: "Validation failed", errors: input.errors }, { status: 422 });

  const tenant = await getTenantById(authResult.tenantId);
  if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  const db = createTenantDb(tenant.id, decryptDbUrl(tenant.dbUrl));

  // An assistant whose answer was lost asks again: with the key, the second ask gets the
  // first draft back instead of a second one.
  const idempotency = await claim(db, ENDPOINT, req.headers.get("Idempotency-Key"), await hashBody(rawBody));
  if (idempotency.kind === "replay") {
    return NextResponse.json(idempotency.body, {
      status: idempotency.status ?? 200,
      headers: { "Idempotent-Replay": "true" },
    });
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

  let response: NextResponse;
  try {
    const result = await draftQuote(db, input.value);
    if (!result.ok) {
      response = NextResponse.json({ error: "Validation failed", errors: result.errors }, { status: result.status });
    } else {
      await logApiWrite(db, authResult, { entity: "quote", endpoint: ENDPOINT, recordId: result.quoteId });
      // The deal's owner hears that a draft is waiting; the bell, not a push.
      if (result.ownerId) {
        const ownerId = result.ownerId;
        await runWithTenant(tenant.id, () =>
          notify({
            userId: ownerId,
            type: "quote_proposed",
            key: "quoteProposed",
            params: { number: result.quoteNumber, who: authResult.key?.name ?? "API" },
            link: `/dashboard/sales/quotes/${result.quoteId}`,
          }),
        ).catch((err) => console.error("[api/quotes] drafted, owner not notified", err));
      }
      response = NextResponse.json(
        {
          status: "draft",
          id: result.quoteId,
          quoteNumber: result.quoteNumber,
          total: result.total,
          lines: result.lines,
        },
        { status: 201 },
      );
    }
  } catch (error) {
    await release(db, idempotency);
    throw error;
  }

  if (response.ok) {
    try {
      await remember(db, idempotency, await response.clone().json(), undefined, response.status);
    } catch {
      await release(db, idempotency);
    }
  } else {
    await release(db, idempotency);
  }
  return response;
}
