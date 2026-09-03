import { after, type NextRequest, NextResponse } from "next/server";

import { eq, inArray } from "drizzle-orm";

import { runAutomations } from "@/components/crm/automation/rule-engine";
import { createTenantDb } from "@/db";
import { deals } from "@/db/schema";
import { authenticateApiRequest } from "@/lib/api-import-auth";
import { leggiRecapito, trova } from "@/lib/contact-point";
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
  // Nessuno ha risposto: non si sa come sia finita, e «persa» è quanto di più vicino la
  // pipeline sappia dire. Il perché resta scritto per esteso.
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
          // ⚠️ Un esito sconosciuto si rifiuta invece di essere ignorato: accettarlo senza
          // chiudere niente farebbe credere a chi ha chiamato di aver chiuso.
          ...(noto ? [] : [{ field: "outcome", message: "unknown outcome" }]),
        ],
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

  if (outcome === LASCIA_APERTO) {
    // ⚠️⚠️ Prima di qualunque lettura: non c'è niente da fare, e dirlo è la risposta.
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

  // ⚠️ I deal pendono da un **contatto**: una persona ancora allo stadio di lead non ne ha
  // uno, e non è un guasto — è il caso normale di chi non è mai stato convertito.
  const persona = await trova(db, recapito.email, recapito.digits);
  if (persona.contactIds.length === 0) {
    return NextResponse.json({ error: "No deal to close for that contact point" }, { status: 404 });
  }

  const suoi: { id: string; status: string; name: string }[] = await db
    .select({ id: deals.id, status: deals.status, name: deals.name })
    .from(deals)
    .where(inArray(deals.contactId, persona.contactIds));

  // ⚠️⚠️ **Solo quelle ancora aperte, e il filtro sta qui e non nella query.** Richiudere
  // una trattativa già chiusa sposterebbe la sua data di chiusura a oggi, e «vinte questo
  // mese» conterebbe cose finite mesi fa — è il difetto che il commento su `closedAt`
  // racconta di aver già pagato. Nella clausola SQL questa riga sarebbe una garanzia che
  // nessun test con un doppio del database può raggiungere; una persona ha una manciata di
  // trattative, quindi filtrarle qui non costa niente e si può difendere.
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
    // Dopo la risposta, come ogni altra scrittura che fa girare le regole: un deal che
    // passa a «persa» è un cambiamento come gli altri, e chi lo sorveglia deve saperlo.
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
