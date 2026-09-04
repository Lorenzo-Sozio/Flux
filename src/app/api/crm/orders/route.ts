import { after, type NextRequest, NextResponse } from "next/server";

import { dispatchWebhook } from "@/actions/webhooks";
import { runAutomations } from "@/components/crm/automation/rule-engine";
import { createTenantDb } from "@/db";
import { contacts, orderItems, orders } from "@/db/schema";
import { authenticateApiRequest } from "@/lib/api-import-auth";
import { doveAnnotare, leggiRecapito, trova } from "@/lib/contact-point";
import { computeDocument } from "@/lib/document-totals";
import { getTenantById } from "@/lib/get-tenant";
import { nextOrderNumber } from "@/lib/order-number";
import { decryptDbUrl } from "@/lib/tenant-db";

const ORIGINE_API = { via: "api" as const, actor: null };

/** One line each, so whoever prepares the order reads them one under the other. */
const SEPARATORE = String.fromCharCode(10);

/**
 * Everything asked for on one line, written out.
 *
 * ⚠️⚠️ **«Come l'ha chiamata» is not decoration.** Whoever took the order matched what the
 * customer said against a price list, and replaced their words with the catalogue entry.
 * If that match was wrong — «capricciosa» recorded as «quattro stagioni», same price,
 * different pizza — nothing else in this order would ever show it. This is the only line a
 * person can catch it on, so it is written whenever the two differ, and left out when they
 * agree because then it says nothing.
 */
function notaDiRiga(r: RigaIn): string {
  const diverso = r.requestedAs && r.requestedAs.toLowerCase() !== r.description.toLowerCase();
  return [
    ["Modifiche", r.note ?? ""],
    ["Richiesto come", diverso ? r.requestedAs : ""],
  ]
    .filter(([, valore]) => valore)
    .map(([etichetta, valore]) => `${etichetta}: ${valore}`)
    .join(SEPARATORE);
}

/** How far the caller's total may differ from ours before the order is refused. */
const TOLLERANZA = 0.01;

/** A line of an order, as an integration hands it over. */
interface RigaIn {
  description: string;
  quantity: number;
  unitPrice: number;
  note?: string;
  /** What the customer called it, when that is not the catalogue name. */
  requestedAs?: string;
}

/**
 * Record an order an assistant took from a customer, in words, on the phone or in chat.
 *
 * Body: `{ "contactPoint": "+39 333 111 2223", "name": "Anna",
 *          "lines": [{ "description": "Margherita", "quantity": 2, "unitPrice": 6.5 }],
 *          "total": 13, "fulfillment": "ritiro", "address": "", "when": "alle 20:30" }`.
 *
 * ## ⚠️⚠️ The prices arrive already set, and this route does not look them up
 *
 * Each line carries the price the assistant **read out to the customer**, copied from the
 * business's own price list. Re-pricing here from this CRM's product catalogue would mean
 * that the day the two drift apart, somebody who ordered by phone is asked for a figure
 * different from the one they were told — and nobody would see it happen.
 *
 * What this route does check is that the caller's declared total is **the total of the
 * lines it sent**. Two systems agreeing on the arithmetic is cheap; an order at the wrong
 * price is not. A mismatch is refused rather than silently corrected: whichever side is
 * wrong, the customer heard one of the two figures.
 *
 * ## ⚠️ An order implies a customer, so one is created if there is none
 *
 * An order hangs off a contact. Somebody ordering for the first time is not in the CRM yet,
 * and refusing would mean the first order of every new customer fails. So the contact is
 * created from what is known — the contact point, and the name if they gave one.
 *
 * ⚠️ **The lead, if there is one, is left alone.** Converting a lead is a commercial gesture
 * with a company and a deal behind it; a takeaway order is not that, and doing it here would
 * be a side effect nobody asked for.
 *
 * ## It arrives as a draft, and that is the point
 *
 * `draft` is an order nobody has worked yet. The assistant took it down; a person decides
 * what to do with it. Marking it `processing` would say that somebody had picked it up.
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
  const grezze = Array.isArray(dati.lines) ? dati.lines : [];

  const righe: RigaIn[] = [];
  for (const grezza of grezze) {
    if (typeof grezza !== "object" || grezza === null) continue;
    const r = grezza as Record<string, unknown>;
    const description = typeof r.description === "string" ? r.description.trim() : "";
    const quantity = typeof r.quantity === "number" ? Math.trunc(r.quantity) : 0;
    const unitPrice = typeof r.unitPrice === "number" ? r.unitPrice : Number.NaN;
    // ⚠️ A line without a name is one nobody can prepare, and a price that is not a number
    // would make the total a number nobody can trust. Both are refusals, not defaults.
    if (!description || quantity < 1 || !Number.isFinite(unitPrice) || unitPrice < 0) continue;
    righe.push({
      description,
      quantity,
      unitPrice,
      note: typeof r.note === "string" ? r.note.trim() : "",
      requestedAs: typeof r.requestedAs === "string" ? r.requestedAs.trim() : "",
    });
  }

  const errors: { field: string; message: string }[] = [];
  if (!contactPoint) errors.push({ field: "contactPoint", message: "contactPoint is required" });
  if (righe.length === 0 || righe.length !== grezze.length) {
    errors.push({
      field: "lines",
      message: "every line needs a description, a quantity of at least 1 and a unit price",
    });
  }
  if (errors.length > 0) {
    return NextResponse.json({ error: "Validation failed", errors }, { status: 422 });
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

  // The same arithmetic quotes and orders already use. No tax rate travels on these lines:
  // a price read out of a price list is what the customer pays.
  const totali = computeDocument({
    lines: righe.map((r) => ({ quantity: r.quantity, unitPrice: r.unitPrice, taxPercent: 0 })),
  });
  const dichiarato = typeof dati.total === "number" ? dati.total : Number.NaN;
  if (Number.isFinite(dichiarato) && Math.abs(dichiarato - totali.total) > TOLLERANZA) {
    return NextResponse.json(
      {
        error: "Total mismatch",
        // Both figures travel back: whoever reads this has to be able to see which side is
        // wrong without reproducing the arithmetic by hand.
        declared: dichiarato,
        computed: totali.total,
      },
      { status: 409 },
    );
  }

  const tenant = await getTenantById(authResult.tenantId);
  if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  const db = createTenantDb(tenant.id, decryptDbUrl(tenant.dbUrl));

  const persona = await trova(db, recapito.email, recapito.digits);
  const dove = doveAnnotare(persona);
  let contactId = dove?.contactId ?? null;
  let creato = false;
  if (!contactId) {
    const nome = typeof dati.name === "string" ? dati.name.trim() : "";
    const [nuovo] = await db
      .insert(contacts)
      .values({
        // ⚠️ The name is **not split in two**. Guessing where a first name ends gets every
        // compound surname wrong, and a full field beside an empty one beats two wrong ones —
        // the same rule the lead import already follows.
        firstName: nome || contactPoint,
        lastName: "",
        email: recapito.email ?? undefined,
        phone: recapito.digits ? contactPoint : undefined,
        source: "assistant",
      })
      .returning({ id: contacts.id });
    contactId = nuovo.id;
    creato = true;
  }

  // ⚠️⚠️ **Quello che serve per prepararlo, dove chi lo prepara guarda.** Ritiro o
  // consegna, per quando, a che indirizzo: senza, l'ordine compare con le righe giuste e
  // nessuno sa se vada consegnato. Una nota sul contatto sarebbe «da un'altra parte», che
  // è esattamente ciò che chi lavora un ordine non deve dover fare.
  //
  // ⚠️ Sono **parole del cliente**, non campi normalizzati: «verso le otto e mezza» è
  // quello che ha detto, e riscriverlo in un orario sarebbe inventare una precisione che
  // non ha dato. Le etichette le mette il codice, il contenuto resta suo.
  const note = [
    ["Consegna", typeof dati.fulfillment === "string" ? dati.fulfillment.trim() : ""],
    ["Per quando", typeof dati.when === "string" ? dati.when.trim() : ""],
    ["Indirizzo", typeof dati.address === "string" ? dati.address.trim() : ""],
  ]
    .filter(([, valore]) => valore)
    .map(([etichetta, valore]) => `${etichetta}: ${valore}`)
    .join(SEPARATORE);

  const numero = await nextOrderNumber(db);
  const adesso = new Date();
  const [ordine] = await db
    .insert(orders)
    .values({
      orderNumber: numero,
      contactId,
      subtotal: String(totali.subtotal),
      taxAmount: String(totali.taxAmount),
      totalAmount: String(totali.total),
      status: "draft",
      notes: note || null,
      orderDate: adesso,
    })
    .returning({ id: orders.id, orderNumber: orders.orderNumber });

  for (let i = 0; i < righe.length; i++) {
    const r = righe[i];
    const linea = totali.lines[i];
    await db.insert(orderItems).values({
      orderId: ordine.id,
      // ⚠️⚠️ **The line says what to prepare; the note says what was asked.** They used
      // to share one field, with the customer's words in brackets after the item — which
      // reads worst exactly when both are there, and gives nowhere to record the second
      // thing below. `description` stays the catalogue entry: it is what the price belongs
      // to, and what somebody looks up on the menu.
      description: r.description,
      notes: notaDiRiga(r) || null,
      quantity: r.quantity,
      unitPrice: String(r.unitPrice),
      taxPercent: "0",
      taxAmount: "0",
      totalPrice: String(linea.net),
    });
  }

  after(() => {
    // ⚠️ No automations on the order: `order` is not one of this CRM's target entities, and
    // inventing one here would be deciding a product question from an integration route.
    // A contact created by an assistant is a contact created, and the rules that watch for
    // one must fire — otherwise the owner's «tell me about new customers» rule would be
    // blind exactly to the customers the assistant brings in.
    if (creato && contactId) {
      runAutomations({
        entityType: "contact",
        entityId: contactId,
        event: "onCreate",
        // Nothing came before a creation, and saying so is what `onCreate` means.
        oldData: {},
        newData: { id: contactId },
      });
    }
    dispatchWebhook("order.created", { order: { ...ordine, contactId } }, ORIGINE_API);
  });

  return NextResponse.json(
    { status: "created", id: ordine.id, orderNumber: ordine.orderNumber, total: totali.total },
    { status: 201 },
  );
}
