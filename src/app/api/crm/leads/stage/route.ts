import { type NextRequest, NextResponse } from "next/server";

import { eq } from "drizzle-orm";

import { dispatchWebhook } from "@/actions/webhooks";
import { createTenantDb } from "@/db";
import { leads } from "@/db/schema";
import { authenticateApiRequest } from "@/lib/api-import-auth";
import { LEAD_STATUSES } from "@/lib/api-import-validators";
import { logApiWrite } from "@/lib/api-write-log";
import { checkAndTrackApiCall, EntitlementError } from "@/lib/billing/usage";
import { findByContactPoint, readContactPoint } from "@/lib/contact-point";
import { getTenantById } from "@/lib/get-tenant";
import { decryptDbUrl } from "@/lib/tenant-db";

/**
 * ⚠️ Every event leaving this route declares that a **machine** caused it, so the
 * integration that wrote it can drop its own echo.
 */
const API_ORIGIN = { via: "api" as const, actor: null };

/**
 * The route's own name, written once: the write log records it, and two literals that
 * have to agree are one literal too many.
 */
const ENDPOINT = "/api/crm/leads/stage";

/**
 * Move a lead to the stage an assistant has brought it to.
 *
 * Body: `{ "contactPoint": "+39 333 111 2223", "status": "qualified" }`.
 *
 * ## ⚠️⚠️ Why this is not the import route with `onDuplicate: "update"`
 *
 * That route **replaces** the lead with the payload it was given: sending a phone number
 * and a status would blank the email, the company, the notes and everything else the
 * salesperson had typed. It is an import surface, and importing is replacing. Saying
 * "this one moved" is a different sentence, and it needs its own verb.
 *
 * ## ⚠️⚠️ Why it matters, and what it is for
 *
 * An assistant that collects what a quote needs and then hands the case over has, until
 * now, told the salesperson in **prose**: a note on the timeline. Prose is not a queue.
 * The salesperson lives in this CRM, and the question they ask every morning is *what is
 * on my desk today* — which here is the leads list, filtered by stage. Moving the lead is
 * what puts it there.
 *
 * ⚠️ **The stage vocabulary is ours, not the caller's.** The assistant speaks its own
 * language and its connector translates: here arrives a status this CRM already knows,
 * validated against the same list the import route uses. One list, one meaning.
 *
 * ## ⚠️ A person who is already a contact is not a failure
 *
 * Converting a lead is the salesperson saying "I have taken this one". There is no lead
 * stage left to move, and there is nothing wrong: the answer says so, and the assistant
 * carries on. A 404 would make it look like the person had vanished, and a retry loop
 * would follow.
 *
 * ## ⚠️ Idempotent by construction, so no claim ledger
 *
 * Setting a stage twice leaves the same stage. A claim would add the one way this can
 * fail — a lock left open blocking the retry — in exchange for nothing.
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

  try {
    await checkAndTrackApiCall(authResult.tenantId);
  } catch (err) {
    if (err instanceof EntitlementError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    throw err;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch (_err) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const dati = (body ?? {}) as Record<string, unknown>;
  const contactPoint = typeof dati.contactPoint === "string" ? dati.contactPoint.trim() : "";
  const status = typeof dati.status === "string" ? dati.status.trim() : "";
  const known = (LEAD_STATUSES as readonly string[]).includes(status);
  if (!contactPoint || !known) {
    return NextResponse.json(
      {
        error: "Validation failed",
        errors: [
          ...(contactPoint ? [] : [{ field: "contactPoint", message: "contactPoint is required" }]),
          ...(known ? [] : [{ field: "status", message: `must be one of ${LEAD_STATUSES.join(", ")}` }]),
        ],
      },
      { status: 422 },
    );
  }

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

  // ⚠️ The **lead** specifically, not "wherever this person's record is". A stage is a
  // property leads have and contacts do not, so the usual contact-wins rule would send the
  // update to a record with nowhere to put it.
  const person = await findByContactPoint(db, parsed.email, parsed.digits);
  const leadId = person.leadIds[0] ?? null;
  if (!leadId) {
    if (person.contactIds.length > 0) {
      return NextResponse.json({ status: "already_a_contact", moved: false });
    }
    return NextResponse.json({ error: "No lead reachable at that contact point" }, { status: 404 });
  }

  const [updated] = await db.update(leads).set({ status }).where(eq(leads.id, leadId)).returning();

  dispatchWebhook("lead.updated", { lead: updated }, API_ORIGIN, db);
  await logApiWrite(db, authResult, { entity: "lead", endpoint: ENDPOINT, recordId: leadId });
  return NextResponse.json({ status: "moved", moved: true, id: leadId, data: updated });
}
