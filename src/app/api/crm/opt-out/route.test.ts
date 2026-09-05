/**
 * La rotta che riceve «questa persona non vuole più essere contattata».
 *
 * ⚠️⚠️ **Il rifiuto riguarda la persona, non il record.** Zittire il contatto e lasciare
 * iscritto il lead terrebbe quella persona esattamente nel pubblico da cui ha chiesto di
 * uscire, e nessuno dei due prodotti se ne accorgerebbe: da qui la campagna parte, di là
 * l'assistente crede di aver rispettato il rifiuto.
 *
 * ⚠️ **E si scrive solo su chi era ancora iscritto.** Il passo che chiama questa rotta è
 * deliberatamente idempotente e viene ritentato: riscrivere `false` sopra `false` farebbe
 * girare di nuovo le regole del titolare su un cambiamento che non è avvenuto, e chi ha una
 * regola «avvisami quando qualcuno si disiscrive» riceverebbe un avviso a ogni tentativo.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { contacts, leads } from "@/db/schema";

const regole: { entityType: string; entityId: string }[] = [];
const scritti: { tabella: string; valori: Record<string, unknown> }[] = [];
let righeLead: { id: string; marketingConsent: boolean }[] = [];
let righeContatti: { id: string; marketingConsent: boolean }[] = [];
let person: { leadIds: string[]; contactIds: string[] } = { leadIds: [], contactIds: [] };

vi.mock("@/components/crm/automation/rule-engine", () => ({
  runAutomations: async (ctx: { entityType: string; entityId: string }) => {
    regole.push(ctx);
  },
}));
vi.mock("next/server", async () => {
  const vero = await vi.importActual<typeof import("next/server")>("next/server");
  return { ...vero, after: (fn: () => unknown) => fn() };
});
vi.mock("@/lib/api-import-auth", () => ({
  authenticateApiRequest: async () => ({ via: "apikey", userId: null, role: "editor", tenantId: "t1" }),
}));
vi.mock("@/lib/get-tenant", () => ({ getTenantById: async () => ({ id: "t1", dbUrl: "x" }) }));
vi.mock("@/lib/tenant-db", () => ({ decryptDbUrl: () => "postgres://finto" }));
vi.mock("@/lib/contact-point", async () => {
  const vero = await vi.importActual<typeof import("@/lib/contact-point")>("@/lib/contact-point");
  return { ...vero, findByContactPoint: async () => ({ ...person, email: null, digits: null }) };
});
vi.mock("@/db", () => ({
  // ⚠️ Il doppio **dichiara la tabella** invece di restituire sempre le stesse righe: la
  // garanzia in prova è che entrambi i record della persona vengano zittiti, e un doppio che
  // non distingue lead da contatto la renderebbe inverificabile.
  createTenantDb: () => ({
    select: () => ({
      from: (tabella: unknown) => ({
        where: async () => (tabella === leads ? righeLead : righeContatti),
      }),
    }),
    update: (tabella: unknown) => ({
      set: (valori: Record<string, unknown>) => {
        // ⚠️ Le due tabelle si nominano **entrambe**: con un `else` implicito una scrittura
        // finita su una terza tabella verrebbe registrata come «contact», e la mutazione che
        // lascia iscritto il contatto passerebbe.
        const nome = tabella === leads ? "lead" : tabella === contacts ? "contact" : "altro";
        scritti.push({ tabella: nome, valori });
        return { where: async () => undefined };
      },
    }),
  }),
}));

const { POST } = await import("@/app/api/crm/opt-out/route");

function richiesta(body: unknown) {
  return new Request("https://x.test/api/crm/opt-out", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    // biome-ignore lint/suspicious/noExplicitAny: NextRequest is a Request at runtime
  }) as any;
}

beforeEach(() => {
  regole.length = 0;
  scritti.length = 0;
  righeLead = [{ id: "l1", marketingConsent: true }];
  righeContatti = [{ id: "c1", marketingConsent: true }];
  person = { leadIds: ["l1"], contactIds: ["c1"] };
});

describe("a refusal said to the assistant reaches the CRM", () => {
  it("⚠️⚠️ silences every record of that person, lead and contact alike", async () => {
    const risposta = await POST(richiesta({ contactPoint: "mario@example.it" }));

    expect(risposta.status).toBe(200);
    expect(scritti.map((s) => s.tabella).sort()).toEqual(["contact", "lead"]);
    for (const scritto of scritti) expect(scritto.valori.marketingConsent).toBe(false);
    expect(await risposta.json()).toMatchObject({ status: "opted_out", ids: ["l1", "c1"] });
  });

  it("runs the owner's rules on the withdrawal", async () => {
    await POST(richiesta({ contactPoint: "mario@example.it" }));

    expect(regole.map((r) => r.entityType).sort()).toEqual(["contact", "lead"]);
    expect(regole.map((r) => r.entityId).sort()).toEqual(["c1", "l1"]);
  });

  it("⚠️ writes nothing on somebody already unsubscribed, and still answers 200", async () => {
    // Il passo che chiama viene ritentato: riscrivere `false` sopra `false` farebbe partire
    // di nuovo l'avviso di chi sorveglia le disiscrizioni.
    righeLead = [{ id: "l1", marketingConsent: false }];
    righeContatti = [{ id: "c1", marketingConsent: false }];

    const risposta = await POST(richiesta({ contactPoint: "mario@example.it" }));

    expect(risposta.status).toBe(200);
    expect(scritti).toHaveLength(0);
    expect(regole).toHaveLength(0);
  });

  it("⚠️ nobody at that contact point is a 404, so the caller can stop trying", async () => {
    person = { leadIds: [], contactIds: [] };

    const risposta = await POST(richiesta({ contactPoint: "mario@example.it" }));

    expect(risposta.status).toBe(404);
    expect(scritti).toHaveLength(0);
  });

  it("refuses a body without a contact point, and says which field is missing", async () => {
    // ⚠️ Il messaggio è la garanzia, non il codice: senza la guardia il rifiuto arriva
    // comunque, ma dice «non è né una email né un numero» di un campo che non è stato
    // mandato affatto — e chi integra va a cercare un errore di formato che non esiste.
    // È la stessa forma di rifiuto delle altre rotte, e deve restare la stessa.
    const risposta = await POST(richiesta({}));

    expect(risposta.status).toBe(422);
    expect(await risposta.json()).toMatchObject({
      errors: [{ field: "contactPoint", message: "contactPoint is required" }],
    });
    expect(scritti).toHaveLength(0);
  });

  it("refuses a contact point that is neither an email nor a phone number", async () => {
    const risposta = await POST(richiesta({ contactPoint: "Mario Rossi" }));

    expect(risposta.status).toBe(422);
    expect(scritti).toHaveLength(0);
  });
});
