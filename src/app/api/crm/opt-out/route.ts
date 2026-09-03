import { after, type NextRequest, NextResponse } from "next/server";

import { eq, inArray } from "drizzle-orm";

import { runAutomations } from "@/components/crm/automation/rule-engine";
import { createTenantDb } from "@/db";
import { contacts, leads } from "@/db/schema";
import { authenticateApiRequest } from "@/lib/api-import-auth";
import { leggiRecapito, trova } from "@/lib/contact-point";
import { getTenantById } from "@/lib/get-tenant";
import { decryptDbUrl } from "@/lib/tenant-db";

/**
 * Record that a person told an integration they do not want to be contacted any more.
 *
 * Body: `{ "contactPoint": "+39 333 111 2223" }`.
 *
 * ## ⚠️⚠️ Why this exists: one person, two consents that never spoke
 *
 * This CRM has always had its own `marketingConsent`, and its own unsubscribe page flips it.
 * The assistant on the other side has always had its own suppression list. Neither knew
 * about the other, so somebody who told the assistant «stop writing to me» kept receiving
 * this CRM's campaigns — and nobody in either product could see that it was happening.
 *
 * A refusal is not scoped to the system it happened to be said in. It is said about the
 * person, and it means everything that company sends them.
 *
 * ## ⚠️⚠️ One direction only, and the other is deliberately absent
 *
 * Unsubscribing from a newsletter here does **not** silence the assistant. Those are two
 * purposes, not one: a follow-up on a quote the customer asked for is not a campaign, and
 * stopping it would mean going quiet on somebody who is waiting for an answer. Merging them
 * would be a mistake in the other direction, and the harder one to notice.
 *
 * ## ⚠️ Nothing arrives but the contact point
 *
 * No reason, no wording, nothing the person wrote. Whatever they said stays in the
 * transcript on the other side, where it has a retention and an erasure path. A quotation
 * copied into this database would be one more copy to reach on an article 17 request.
 *
 * ## ⚠️ Nobody found is a 404, and the caller treats it as done
 *
 * Silencing somebody this CRM has never heard of is a no-op, and the requested end state —
 * not reachable from here — already holds. The caller says so explicitly, so that this
 * never becomes a failure it retries for ever.
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
      {
        error: "Validation failed",
        errors: [{ field: "contactPoint", message: "contactPoint is required" }],
      },
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

  // ⚠️⚠️ **Both records, and not the one that wins.** A note goes where a person will read
  // it, so it picks the contact over the lead. A refusal is not a place to write: it is a
  // state every record of that person must be in. Silencing the contact and leaving the
  // lead subscribed would keep them in exactly the audience they asked to leave.
  const persona = await trova(db, recapito.email, recapito.digits);
  if (persona.leadIds.length === 0 && persona.contactIds.length === 0) {
    return NextResponse.json({ error: "No person reachable at that contact point" }, { status: 404 });
  }

  const suoiLead: { id: string; marketingConsent: boolean | null }[] = persona.leadIds.length
    ? await db
        .select({ id: leads.id, marketingConsent: leads.marketingConsent })
        .from(leads)
        .where(inArray(leads.id, persona.leadIds))
    : [];
  const suoiContatti: { id: string; marketingConsent: boolean | null }[] = persona.contactIds.length
    ? await db
        .select({ id: contacts.id, marketingConsent: contacts.marketingConsent })
        .from(contacts)
        .where(inArray(contacts.id, persona.contactIds))
    : [];

  // ⚠️⚠️ **Only the records that were still subscribed, and the filter is here rather than
  // in the query.** Rewriting a `false` to `false` would fire the owner's rules again on a
  // change that did not happen: a rule that notifies somebody when consent is withdrawn
  // would send that notice on every retry of a step that is deliberately idempotent. In the
  // SQL clause this would be a guarantee no test against a database double can reach; a
  // person has a handful of records, so filtering here costs nothing and can be defended.
  const daZittire = [
    ...suoiLead.filter((r) => r.marketingConsent).map((r) => ({ ...r, entityType: "lead" as const })),
    ...suoiContatti.filter((r) => r.marketingConsent).map((r) => ({ ...r, entityType: "contact" as const })),
  ];

  const adesso = new Date();
  const zittiti: string[] = [];
  for (const riga of daZittire) {
    if (riga.entityType === "lead") {
      await db.update(leads).set({ marketingConsent: false, updatedAt: adesso }).where(eq(leads.id, riga.id));
    } else {
      await db.update(contacts).set({ marketingConsent: false, updatedAt: adesso }).where(eq(contacts.id, riga.id));
    }
    zittiti.push(riga.id);
    // After the response, like every other write that runs rules: withdrawing consent is a
    // change the owner may well want to watch.
    after(() =>
      runAutomations({
        entityType: riga.entityType,
        entityId: riga.id,
        event: "onUpdate",
        oldData: { id: riga.id, marketingConsent: true },
        newData: { id: riga.id, marketingConsent: false },
      }),
    );
  }

  // ⚠️ `200` even when nothing changed: the person is here and is not subscribed, which is
  // the state that was asked for. A `404` would say «not here», which is a different fact
  // and would send whoever reads it looking for the wrong thing.
  return NextResponse.json({ status: "opted_out", ids: zittiti }, { status: 200 });
}
