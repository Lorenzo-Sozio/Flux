/**
 * La rotta che chiude le trattative di chi l'assistente ha smesso di seguire.
 *
 * ⚠️⚠️ **Un processo arrivato a destinazione NON vince una trattativa.** I tre esiti
 * descrivono il processo dell'assistente, non la vendita: `RAGGIUNTO` vuol dire che è
 * arrivato dove andava — un collega ha preso il caso, il cliente ha risposto — e niente di
 * tutto ciò dice che siano passati dei soldi. Segnare «vinta» su quella base metterebbe nel
 * fatturato del titolare una vittoria che nessuno ha verificato.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const regole: { entityType: string; entityId: string; event: string }[] = [];
let aperti: { id: string; status: string; name: string }[] = [];
const scritti: Record<string, unknown>[] = [];
let persona: { leadIds: string[]; contactIds: string[] } = { leadIds: [], contactIds: ["c1"] };

vi.mock("@/components/crm/automation/rule-engine", () => ({
  runAutomations: async (ctx: { entityType: string; entityId: string; event: string }) => {
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
  return { ...vero, trova: async () => ({ ...persona, email: null, digits: null }) };
});
vi.mock("@/db", () => ({
  createTenantDb: () => ({
    select: () => ({ from: () => ({ where: async () => aperti }) }),
    update: () => ({
      set: (valori: Record<string, unknown>) => {
        scritti.push(valori);
        return { where: () => ({ returning: async () => [{ id: "d1", ...valori }] }) };
      },
    }),
  }),
}));

const { POST } = await import("@/app/api/crm/close/route");

function richiesta(corpo: unknown) {
  return new Request("https://x.test/api/crm/close", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(corpo),
    // biome-ignore lint/suspicious/noExplicitAny: NextRequest is a Request at runtime
  }) as any;
}

beforeEach(() => {
  regole.length = 0;
  scritti.length = 0;
  aperti = [{ id: "d1", status: "open", name: "Bagno" }];
  persona = { leadIds: [], contactIds: ["c1"] };
});

describe("closing what the assistant stopped following", () => {
  it("closes an open deal as lost, with the reason written for a person", async () => {
    // Chi apre quella trattativa deve poter vedere che l'ha chiusa un assistente, e perché.
    const risposta = await POST(richiesta({ contactPoint: "mario@example.it", outcome: "ABBANDONATO" }));

    expect(risposta.status).toBe(200);
    expect(scritti).toHaveLength(1);
    expect(scritti[0].status).toBe("lost");
    expect(String(scritti[0].lostReason)).toContain("nessuna risposta");
    expect(scritti[0].closedAt).toBeInstanceOf(Date);
  });

  it("⚠️⚠️ a process that reached its destination leaves the deal alone", async () => {
    // Segnare «vinta» perché il processo è arrivato a destinazione metterebbe nel fatturato
    // del titolare una vittoria che nessuno ha verificato.
    const risposta = await POST(richiesta({ contactPoint: "mario@example.it", outcome: "RAGGIUNTO" }));

    expect(risposta.status).toBe(200);
    expect(await risposta.json()).toMatchObject({ status: "left_open" });
    expect(scritti).toHaveLength(0);
    expect(regole).toHaveLength(0);
  });

  it("⚠️ runs the owner's rules on the deal that changed", async () => {
    // Un deal che passa a «persa» è un cambiamento come gli altri, e chi lo sorveglia deve
    // saperlo — comprese le regole che lo riaprono o avvisano qualcuno.
    await POST(richiesta({ contactPoint: "mario@example.it", outcome: "ABBANDONATO" }));

    expect(regole).toHaveLength(1);
    expect(regole[0]).toMatchObject({ entityType: "deal", entityId: "d1", event: "onUpdate" });
  });

  it("⚠️⚠️ never re-closes a deal that is already closed", async () => {
    // Richiuderla sposterebbe la sua data di chiusura a oggi, e «vinte questo mese»
    // conterebbe cose finite mesi fa.
    aperti = [
      { id: "vecchia", status: "lost", name: "Chiusa a marzo" },
      { id: "d1", status: "open", name: "Bagno" },
    ];

    await POST(richiesta({ contactPoint: "mario@example.it", outcome: "ABBANDONATO" }));

    expect(scritti).toHaveLength(1);
    expect(regole.map((r) => r.entityId)).toEqual(["d1"]);
  });

  it("nothing to close is a 404, not a silent success", async () => {
    // Chi ha chiamato deve poter distinguere «non c'era niente» da «l'ho chiusa».
    aperti = [{ id: "vecchia", status: "lost", name: "Chiusa a marzo" }];

    expect((await POST(richiesta({ contactPoint: "mario@example.it", outcome: "ABBANDONATO" }))).status).toBe(404);

    aperti = [{ id: "d1", status: "open", name: "Bagno" }];
    persona = { leadIds: ["l1"], contactIds: [] };
    expect((await POST(richiesta({ contactPoint: "mario@example.it", outcome: "ABBANDONATO" }))).status).toBe(404);
    expect(scritti).toHaveLength(0);
  });

  it("⚠️ an unknown outcome is refused instead of ignored", async () => {
    // Accettarlo senza chiudere niente farebbe credere a chi ha chiamato di aver chiuso.
    for (const corpo of [
      { contactPoint: "mario@example.it", outcome: "PERSA" },
      { contactPoint: "mario@example.it" },
      { outcome: "ABBANDONATO" },
    ]) {
      expect((await POST(richiesta(corpo))).status).toBe(422);
    }
    expect(scritti).toHaveLength(0);
  });
});
