/**
 * The route that says «this one is on your desk now», and what it must not do.
 *
 * ⚠️⚠️ **It moves the stage and nothing else.** The import route with
 * `onDuplicate: "update"` replaces the lead with the payload it was given: a phone number
 * and a status would blank the email, the company and the notes. That is why this exists
 * as its own verb rather than as a flag on that one, and it is the first thing pinned here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/** What was written, and onto which row. */
const aggiornamenti: { id: string; valori: Record<string, unknown> }[] = [];
/** The lines saying who called the route. */
const scritture: Record<string, unknown>[] = [];
const emessi: { evento: string; carico: unknown }[] = [];
let person: { leadIds: string[]; contactIds: string[] } = { leadIds: ["l1"], contactIds: [] };

vi.mock("@/lib/billing/usage", () => ({
  checkAndTrackApiCall: async () => undefined,
  EntitlementError: class extends Error {},
}));
vi.mock("@/lib/api-import-auth", () => ({
  authenticateApiRequest: async () => ({ via: "apikey", userId: null, role: "editor", tenantId: "t1" }),
}));
vi.mock("@/lib/get-tenant", () => ({ getTenantById: async () => ({ id: "t1", dbUrl: "x" }) }));
vi.mock("@/lib/tenant-db", () => ({ decryptDbUrl: () => "postgres://finto" }));
vi.mock("@/lib/contact-point", async () => {
  const vero = await vi.importActual<typeof import("@/lib/contact-point")>("@/lib/contact-point");
  return { ...vero, findByContactPoint: async () => ({ ...person, email: null, digits: null }) };
});
vi.mock("@/actions/webhooks", () => ({
  dispatchWebhook: (evento: string, carico: unknown) => {
    emessi.push({ evento, carico });
  },
}));
vi.mock("@/lib/api-write-log", () => ({
  logApiWrite: async (_db: unknown, _auth: unknown, riga: Record<string, unknown>) => {
    scritture.push(riga);
  },
}));

/** Un doppio che **dichiara** che cosa restituisce, e registra che cosa gli si scrive. */
vi.mock("@/db", () => ({
  createTenantDb: () => ({
    update: () => ({
      set: (valori: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            aggiornamenti.push({ id: "l1", valori });
            return [{ id: "l1", status: valori.status, email: "mario@example.it" }];
          },
        }),
      }),
    }),
  }),
}));
vi.mock("drizzle-orm", () => ({ eq: () => undefined }));
// ⚠️ Con  sostituito, lo schema vero non si costruisce: qui serve solo
// il nome della tabella su cui la rotta scrive.
vi.mock("@/db/schema", () => ({ leads: { id: "id", status: "status" } }));

const { POST } = await import("./route");

function richiesta(corpo: unknown) {
  return { json: async () => corpo } as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
  aggiornamenti.length = 0;
  scritture.length = 0;
  emessi.length = 0;
  person = { leadIds: ["l1"], contactIds: [] };
});

describe("lo stadio del lead", () => {
  it("⚠️⚠️ scrive SOLO lo stadio, e non tocca il resto della scheda", async () => {
    // Il difetto che questa rotta esiste per non avere: l'importazione sostituisce, e una
    // scheda sostituita perde tutto quello che il commerciale ci aveva scritto.
    const r = await POST(richiesta({ contactPoint: "+39 333 111 2223", status: "qualified" }));

    expect(r.status).toBe(200);
    expect(aggiornamenti).toHaveLength(1);
    expect(Object.keys(aggiornamenti[0].valori)).toEqual(["status"]);
    expect(aggiornamenti[0].valori.status).toBe("qualified");
  });

  it("⚠️ uno stadio che questo CRM non conosce è un rifiuto, non una scrittura", async () => {
    // Uno stadio inventato non produrrebbe un errore: produrrebbe un lead in uno stato che
    // nessuna schermata sa mostrare e nessun filtro sa trovare.
    const r = await POST(richiesta({ contactPoint: "+39 333 111 2223", status: "pronta" }));

    expect(r.status).toBe(422);
    expect(aggiornamenti).toHaveLength(0);
  });

  it("⚠️ senza recapito non si scrive niente", async () => {
    const r = await POST(richiesta({ status: "qualified" }));

    expect(r.status).toBe(422);
    expect(aggiornamenti).toHaveLength(0);
  });

  it("⚠️⚠️ una persona già convertita in contatto NON è un errore", async () => {
    // Convertire un lead è il commerciale che dice «questo l'ho preso io»: non c'è più uno
    // stadio da muovere. Un 404 lo farebbe sembrare sparito, e chi chiama ritenterebbe.
    person = { leadIds: [], contactIds: ["c1"] };

    const r = await POST(richiesta({ contactPoint: "+39 333 111 2223", status: "qualified" }));

    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ status: "already_a_contact", moved: false });
    expect(aggiornamenti).toHaveLength(0);
  });

  it("chi non esiste è un 404", async () => {
    person = { leadIds: [], contactIds: [] };

    const r = await POST(richiesta({ contactPoint: "+39 333 111 2223", status: "qualified" }));

    expect(r.status).toBe(404);
  });

  it("⚠️ lo dice alle integrazioni, e scrive chi è stato", async () => {
    // Senza l'evento, chi guarda i lead da fuori non sa che si è mosso; senza la riga di
    // registro, «che cosa ha fatto l'assistente nel mio CRM» resta senza risposta.
    await POST(richiesta({ contactPoint: "+39 333 111 2223", status: "qualified" }));

    expect(emessi.map((e) => e.evento)).toEqual(["lead.updated"]);
    expect(scritture[0]).toMatchObject({ entity: "lead", endpoint: "/api/crm/leads/stage" });
  });
});
