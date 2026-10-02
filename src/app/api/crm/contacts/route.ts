import { type NextRequest, NextResponse } from "next/server";

import { eq } from "drizzle-orm";

import { createTenantDb } from "@/db";
import { contacts } from "@/db/schema";
import { runRulesAfterApiWrite } from "@/lib/api-automations";
import { claim, hashBody, release, remember } from "@/lib/api-idempotency";
import { gateApiRequest } from "@/lib/api-import-auth";
import { asUpdate, buildContactPayload, parseOnDuplicate, validateContactInput } from "@/lib/api-import-validators";
import { listResponse } from "@/lib/api-read-route";
import { logApiWrite } from "@/lib/api-write-log";
import { checkAndTrackApiCall, EntitlementError } from "@/lib/billing/usage";
import { getTenantById } from "@/lib/get-tenant";
import { decryptDbUrl } from "@/lib/tenant-db";
import { dispatchWebhook } from "@/lib/webhook-dispatch";
import { apiOrigin } from "@/lib/webhook-envelope";

/**
 * The route's own name, written once: the idempotency ledger and the write log both
 * record it, and two literals that have to agree are one literal too many.
 */
const ENDPOINT = "/api/crm/contacts";

/** What a key must hold to call this (src/lib/api-scopes.ts). */
const SCOPE = { entity: "contacts", access: "write" } as const;
const READ_SCOPE = { entity: "contacts", access: "read" } as const;

/**
 * A page of contacts, oldest change first; `updatedSince` and `cursor` to reconcile
 * (src/lib/api-read.ts). Nothing is written, so nothing is logged.
 */
export async function GET(req: NextRequest) {
  const gate = await gateApiRequest(req, READ_SCOPE);
  if (gate.response) return gate.response;
  return listResponse(req, gate.auth, "contacts");
}

export async function POST(req: NextRequest) {
  const gate = await gateApiRequest(req, SCOPE);
  if (gate.response) return gate.response;
  const authResult = gate.auth;
  // Marks every event this request causes as written by the API, and by which key: an
  // integration drops its own writes by that, and still hears everyone else's.
  const API_ORIGIN = apiOrigin(authResult);

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

  const { errors, data } = validateContactInput(body);
  if (errors.length > 0 || !data) {
    return NextResponse.json({ error: "Validation failed", errors }, { status: 422 });
  }

  const onDuplicate = parseOnDuplicate(body as Record<string, unknown>);

  // Resolve the tenant DB directly (getDb() reads x-tenant-id from internal
  // headers set by middleware, which is only available for session-based calls).
  const tenant = await getTenantById(authResult.tenantId);
  if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  // ⚠️ No `platformDb` fallback. There used to be one, behind a check on
  // `authResult.tenantId` that the 400 above has already made true — dead code,
  // but sitting in the one place where reaching it would write a customer's
  // contact into the platform registry instead of their own database.
  const db = createTenantDb(tenant.id, decryptDbUrl(tenant.dbUrl));

  // ── The same request twice ──────────────────────────────────────────────────
  //
  // A caller whose response never arrived does not know whether this landed, and
  // sending it again creates a second copy of whatever this route cannot match
  // on. A key makes that retry safe. No key, and nothing changes.
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

  // ⚠️ Every exit goes through here. A success is remembered, so a repeat
  // replays it; anything else releases the key, so a caller who corrects
  // their request may send it again under the same one. Without the release
  // a rejected request would hold its key for the whole stale window.
  let response: Response;
  try {
    response = await (async () => {
      if (data.email) {
        // The whole row, not just its id: it is what the rules compare against when this
        // becomes an update. Same statement, same cost.
        const [existing] = await db.select().from(contacts).where(eq(contacts.email, data.email));

        if (existing) {
          if (onDuplicate === "error") {
            return NextResponse.json(
              { error: "Conflict", reason: "duplicate_email", existingId: existing.id },
              { status: 409 },
            );
          }

          if (onDuplicate === "update") {
            const [updated] = await db
              .update(contacts)
              .set(asUpdate(buildContactPayload(data, authResult.userId), data))
              .where(eq(contacts.id, existing.id))
              .returning();
            dispatchWebhook("contact.updated", { contact: updated }, API_ORIGIN, db);
            runRulesAfterApiWrite(tenant.id, {
              entityType: "contact",
              entityId: updated.id,
              event: "onUpdate",
              oldData: existing as Record<string, unknown>,
              newData: updated as Record<string, unknown>,
            });
            await logApiWrite(db, authResult, { entity: "contact", endpoint: ENDPOINT, recordId: updated.id });
            return NextResponse.json({ status: "updated", id: updated.id, data: updated });
          }

          return NextResponse.json({ status: "skipped", reason: "duplicate_email", existingId: existing.id });
        }
      }

      const [created] = await db.insert(contacts).values(buildContactPayload(data, authResult.userId)).returning();
      dispatchWebhook("contact.created", { contact: created }, API_ORIGIN, db);
      // The same rules a contact typed into the dashboard runs. Only here and in the single
      // routes: see runRulesAfterApiWrite for why an import in bulk runs none.
      runRulesAfterApiWrite(tenant.id, {
        entityType: "contact",
        entityId: created.id,
        event: "onCreate",
        oldData: {},
        newData: created as Record<string, unknown>,
      });
      await logApiWrite(db, authResult, { entity: "contact", endpoint: ENDPOINT, recordId: created.id });

      return NextResponse.json({ status: "created", id: created.id, data: created }, { status: 201 });
    })();
  } catch (error) {
    await release(db, idempotency);
    throw error;
  }

  if (response.ok) {
    try {
      await remember(db, idempotency, await response.clone().json(), undefined, response.status);
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
