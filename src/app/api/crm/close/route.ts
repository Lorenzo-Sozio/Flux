import { after, type NextRequest, NextResponse } from "next/server";

import { eq, inArray } from "drizzle-orm";

import { runAutomations } from "@/components/crm/automation/rule-engine";
import { createTenantDb } from "@/db";
import { deals } from "@/db/schema";
import { authenticateApiRequest } from "@/lib/api-import-auth";
import { checkAndTrackApiCall, EntitlementError } from "@/lib/billing/usage";
import { findByContactPoint, readContactPoint } from "@/lib/contact-point";
import { getTenantById } from "@/lib/get-tenant";
import { decryptDbUrl } from "@/lib/tenant-db";

/**
 * Close the deals of a person whose process an integration has finished.
 *
 * Body: `{ "contactPoint": "+39 333 111 2223", "outcome": "ABBANDONATO" }`.
 *
 * ## ⚠️⚠️ Why an assistant may close a deal at all
 *
 * Because otherwise nobody does. An assistant chases a quote, nobody ever answers, it stops
 * — and the deal stays in the pipeline for ever. The owner finds a board full of things that
 * ended months ago, and a forecast built on them.
 *
 * ## ⚠️⚠️ A process that reached its destination does NOT win a deal
 *
 * The three outcomes describe **the assistant's process**, not the sale. `RAGGIUNTO` means
 * it got where it was going — a colleague took the case over, the customer answered — and
 * none of that says money changed hands. Marking a deal won on that basis would put a
 * victory nobody verified into the owner's revenue, which is the one number they must be
 * able to trust. So `RAGGIUNTO` leaves the deal exactly as it is, and says so.
 *
 * What closes a deal is a process that did **not** reach its destination, and the reason is
 * written where a person will read it: whoever opens that deal must be able to see that an
 * assistant closed it, and why.
 *
 * ## The owner's rules run afterwards
 *
 * A deal moving to `lost` is a change like any other, and the rules that watch for it must
 * fire — including the ones that reopen it or notify somebody.
 */
const CHIUDONO: Record<string, string> = {
  // Nobody answered: how it ended is unknown, and "lost" is the closest the pipeline
  // can say. The reason stays written out in full.
  ABBANDONATO: "L'assistente ha chiuso: nessuna risposta dopo i solleciti",
  NON_RAGGIUNTO: "L'assistente ha chiuso: il processo non è arrivato a destinazione",
};
const LASCIA_APERTO = "RAGGIUNTO";

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
  try {
    body = await req.json();
  } catch (_err) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const dati = (body ?? {}) as Record<string, unknown>;
  const contactPoint = typeof dati.contactPoint === "string" ? dati.contactPoint.trim() : "";
  const outcome = typeof dati.outcome === "string" ? dati.outcome.trim() : "";
  const noto = outcome === LASCIA_APERTO || outcome in CHIUDONO;
  if (!contactPoint || !noto) {
    return NextResponse.json(
      {
        error: "Validation failed",
        errors: [
          ...(contactPoint ? [] : [{ field: "contactPoint", message: "contactPoint is required" }]),
          // ⚠️ An unknown outcome is refused rather than ignored: accepting it and closing
          // nothing would leave the caller believing they had closed something.
          ...(noto ? [] : [{ field: "outcome", message: "unknown outcome" }]),
        ],
      },
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

  if (outcome === LASCIA_APERTO) {
    // ⚠️⚠️ Before any read: there is nothing to do, and saying so is the answer.
    return NextResponse.json(
      {
        status: "left_open",
        reason: "a process reaching its destination does not say the sale happened",
      },
      { status: 200 },
    );
  }

  const tenant = await getTenantById(authResult.tenantId);
  if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  const db = createTenantDb(tenant.id, decryptDbUrl(tenant.dbUrl));

  // ⚠️ Deals hang off a **contact**: somebody still at the lead stage has none, and that
  // is not a fault — it is the ordinary case of a person never converted.
  const person = await findByContactPoint(db, parsed.email, parsed.digits);
  if (person.contactIds.length === 0) {
    return NextResponse.json({ error: "No deal to close for that contact point" }, { status: 404 });
  }

  const suoi: { id: string; status: string; name: string }[] = await db
    .select({ id: deals.id, status: deals.status, name: deals.name })
    .from(deals)
    .where(inArray(deals.contactId, person.contactIds));

  // ⚠️⚠️ **Only the ones still open, and the filter lives here rather than in the query.**
  // Re-closing an already closed deal would move its close date to today, and "won this
  // month" would count things finished months ago — the defect the comment on `closedAt`
  // records having already paid for. Inside the SQL clause this line would be a guarantee
  // no test with a database double can reach; a person has a handful of deals, so
  // filtering here costs nothing and can be defended.
  const aperti = suoi.filter((d) => d.status === "open");

  if (aperti.length === 0) {
    return NextResponse.json({ error: "No deal to close for that contact point" }, { status: 404 });
  }

  const chiuseAt = new Date();
  const chiusi: string[] = [];
  for (const affare of aperti) {
    const [dopo] = await db
      .update(deals)
      .set({
        status: "lost",
        closedAt: chiuseAt,
        lostReason: CHIUDONO[outcome],
        updatedAt: chiuseAt,
      })
      .where(eq(deals.id, affare.id))
      .returning();
    chiusi.push(affare.id);
    // After the response, like every other write that runs the rules: a deal moving to
    // "lost" is a change like any other, and whoever watches for it must hear.
    after(() =>
      runAutomations({
        entityType: "deal",
        entityId: affare.id,
        event: "onUpdate",
        oldData: affare as Record<string, unknown>,
        newData: dopo as Record<string, unknown>,
      }),
    );
  }

  return NextResponse.json({ status: "closed", ids: chiusi }, { status: 200 });
}
