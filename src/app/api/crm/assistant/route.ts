import { type NextRequest, NextResponse } from "next/server";

import { createTenantDb } from "@/db";
import { gateApiRequest } from "@/lib/api-import-auth";
import { logApiWrite } from "@/lib/api-write-log";
import { markWithAssistant } from "@/lib/assistant-handling";
import { checkAndTrackApiCall, EntitlementError } from "@/lib/billing/usage";
import { findByContactPoint, readContactPoint } from "@/lib/contact-point";
import { getTenantById } from "@/lib/get-tenant";
import { decryptDbUrl } from "@/lib/tenant-db";

/**
 * The route's own name, written once: the write log records it, and two literals that have
 * to agree are one literal too many.
 */
const ENDPOINT = "/api/crm/assistant";

/** What a key must hold to call this (src/lib/api-scopes.ts). */
const SCOPE = { entity: "assistant", access: "write" } as const;

/**
 * «I am working with this person» — or «not any more». Body:
 * `{ "contactPoint": "+39 333 111 2223", "handling": true }`.
 *
 * Marks every lead and contact at that address with the key's name (src/lib/assistant-handling.ts):
 * Flux's sequences and campaigns then leave the person to the assistant, and the record says
 * who has them. Naturally repeatable — marking twice is marking once — so it takes no
 * `Idempotency-Key`.
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

  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    body = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const errors: { field: string; message: string }[] = [];
  let point: { email: string | null; digits: string | null } | null = null;
  if (typeof body.contactPoint !== "string" || !body.contactPoint.trim()) {
    errors.push({ field: "contactPoint", message: "contactPoint is required" });
  } else {
    try {
      point = readContactPoint(body.contactPoint);
    } catch {
      errors.push({ field: "contactPoint", message: "Not an email address or a phone number" });
    }
  }
  if (typeof body.handling !== "boolean") errors.push({ field: "handling", message: "handling must be true or false" });
  if (errors.length > 0 || !point) return NextResponse.json({ error: "Validation failed", errors }, { status: 422 });

  const tenant = await getTenantById(authResult.tenantId);
  if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  const db = createTenantDb(tenant.id, decryptDbUrl(tenant.dbUrl));

  const person = await findByContactPoint(db, point.email, point.digits);
  if (person.leadIds.length === 0 && person.contactIds.length === 0) {
    return NextResponse.json({ error: "No person reachable at that contact point" }, { status: 404 });
  }

  // A key touches only what it marked; a signed-in administrator, anything.
  const keyId = authResult.via === "session" ? null : (authResult.key?.id ?? "unknown");
  const ids = await markWithAssistant(
    db,
    person,
    body.handling as boolean,
    authResult.key?.name ?? "API",
    new Date(),
    keyId,
  );
  if (ids.length === 0) {
    return NextResponse.json(
      { error: "Another integration is handling this person; only its key can change that", code: "held_by_another" },
      { status: 409 },
    );
  }
  await logApiWrite(db, authResult, {
    entity: "assistant",
    endpoint: ENDPOINT,
    recordId: ids.length === 1 ? ids[0] : null,
    rows: ids.length,
  });
  return NextResponse.json({ handling: body.handling, ids });
}
