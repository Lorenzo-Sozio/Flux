/**
 * The route that receives an order an assistant took by voice.
 *
 * ⚠️⚠️ **Prices arrive already decided, and this route does not recompute them from its
 * own catalogue.** Each line carries the price the assistant *said aloud* to the customer,
 * copied from the business's own list. Recomputing here would mean that the day the two
 * catalogues diverge, somebody who ordered by phone is asked for a figure different from
 * the one they were told, and nobody notices.
 *
 * What is checked instead is that the declared total **is the total of the lines that
 * were sent**: two systems agreeing on the arithmetic is cheap; an order at the wrong price
 * sbagliato no.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const inseriti: { tabella: string; valori: Record<string, unknown> }[] = [];
const regole: { entityType: string; event: string }[] = [];
const eventi: string[] = [];
let contatti: { id: string }[] = [];

vi.mock("@/lib/billing/usage", () => ({
  checkAndTrackApiCall: async () => undefined,
  EntitlementError: class extends Error {},
}));
vi.mock("@/components/crm/automation/rule-engine", () => ({
  runAutomations: async (ctx: { entityType: string; event: string }) => {
    regole.push(ctx);
  },
}));
vi.mock("@/actions/webhooks", () => ({
  dispatchWebhook: async (evento: string) => {
    eventi.push(evento);
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
  return {
    ...vero,
    findByContactPoint: async () => ({ leadIds: [], contactIds: contatti.map((c) => c.id), email: null, digits: null }),
  };
});
vi.mock("@/lib/order-number", () => ({ nextOrderNumber: async () => "ORD-2026-0007" }));
vi.mock("@/db", () => ({
  createTenantDb: () => ({
    // ⚠️ The double **declares** its reads too, and without this line the notification was
    // broken on the bench with nothing saying so: `select` did not exist, the route threw,
    // and the `catch` protecting the order ate the error. A double that does not declare
    // what is needed turns a function that does not exist green.
    select: () => ({
      from: () => ({
        where: async () => amministratori,
      }),
    }),
    insert: (tabella: { [k: string]: unknown }) => ({
      values: (valori: Record<string, unknown>) => {
        // The table name is read from drizzle's own symbol: the double has to be able to
        // say **which** row was written, or "the order created a contact" would be
        // indistinguishable from "the order wrote some row or other".
        const nome = String((tabella as { [k: symbol]: unknown })[Symbol.for("drizzle:Name")] ?? "?");
        inseriti.push({ tabella: nome, valori });
        // ⚠️ A **real** Promise, not an object with a `then`: the order lines are awaited
        // without asking for anything back, while the order and the contact call
        // `returning`. Un thenable scritto a mano farebbe la stessa cosa e sarebbe la
        // a shape this project has already decided not to have.
        const attesa = Promise.resolve(undefined) as Promise<undefined> & {
          returning: () => Promise<{ id: string; orderNumber: unknown }[]>;
        };
        attesa.returning = async () => [{ id: `${nome}-1`, orderNumber: valori.orderNumber ?? null }];
        return attesa;
      },
    }),
  }),
}));

//: Who receives the notification. A declared list: a double always returning the empty
//: set would turn green even the case where nothing is written to anybody.
let amministratori: { id: string }[] = [{ id: "u1" }, { id: "u2" }];

const { POST } = await import("@/app/api/crm/orders/route");

function richiesta(body: unknown) {
  return new Request("https://x.test/api/crm/orders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    // biome-ignore lint/suspicious/noExplicitAny: NextRequest is a Request at runtime
  }) as any;
}

const ORDINE = {
  contactPoint: "anna@example.it",
  name: "Anna",
  lines: [
    { description: "Margherita", quantity: 2, unitPrice: 6.5 },
    { description: "Diavola", quantity: 1, unitPrice: 8.5, note: "poco piccante" },
  ],
  total: 21.5,
  fulfillment: "ritiro",
  when: "alle 20:30",
};

beforeEach(() => {
  inseriti.length = 0;
  regole.length = 0;
  eventi.length = 0;
  contatti = [{ id: "c1" }];
});

describe("an order taken by an assistant", () => {
  it("records the order with the prices it was given", async () => {
    const risposta = await POST(richiesta(ORDINE));

    expect(risposta.status).toBe(201);
    const ordine = inseriti.find((i) => i.tabella === "order");
    expect(ordine?.valori.totalAmount).toBe("21.5");
    expect(ordine?.valori.orderNumber).toBe("ORD-2026-0007");
    const righe = inseriti.filter((i) => i.tabella === "order_item");
    expect(righe.map((r) => r.valori.unitPrice)).toEqual(["6.5", "8.5"]);
    expect(righe.map((r) => r.valori.quantity)).toEqual([2, 1]);
  });

  it("⚠️ arrives as a draft, because nobody has worked it yet", async () => {
    await POST(richiesta(ORDINE));

    expect(inseriti.find((i) => i.tabella === "order")?.valori.status).toBe("draft");
  });

  it("⚠️⚠️ refuses an order whose declared total is not the total of its lines", async () => {
    // Whichever side got it wrong, one of the two figures is the one the customer
    // ha sentito. Correggerla in silenzio significherebbe registrarne un'altra.
    const risposta = await POST(richiesta({ ...ORDINE, total: 18 }));

    expect(risposta.status).toBe(409);
    expect(await risposta.json()).toMatchObject({ declared: 18, computed: 21.5 });
    expect(inseriti).toHaveLength(0);
  });

  it("⚠️ the line says what to prepare, and the note says what was asked", async () => {
    // A line reading "Diavola" when the customer asked for it without the heat is an order
    // prepared wrongly. But the item stays the catalogue one: that is what the price belongs
    // to, and what somebody looks up on the menu.
    await POST(richiesta(ORDINE));

    const righe = inseriti.filter((i) => i.tabella === "order_item");
    expect(righe[1].valori.description).toBe("Diavola");
    expect(String(righe[1].valori.notes)).toContain("Modifiche: poco piccante");
  });

  it("⚠️⚠️ says which line an extra belongs to", async () => {
    // An extra the catalogue prices is a line of its own — the only way its price is the
    // one quoted to the customer — and on an order with two pizzas "wholemeal base" alone
    // does not say which of them it belongs to.
    await POST(
      richiesta({
        ...ORDINE,
        lines: [
          { description: "Quattro formaggi", quantity: 1, unitPrice: 9.5 },
          { description: "impasto integrale", quantity: 1, unitPrice: 1, appliesTo: "Quattro formaggi" },
        ],
        total: 10.5,
      }),
    );

    const righe = inseriti.filter((i) => i.tabella === "order_item");
    expect(String(righe[1].valori.notes)).toContain("Per: Quattro formaggi");
  });

  it("⚠️⚠️ records what the customer called it when the match changed the words", async () => {
    // Whoever took the order matched what the customer said against a catalogue item. If
    // that match was wrong — "capricciosa" become "quattro stagioni", same price, different
    // pizza — nothing else in this order would show it.
    await POST(
      richiesta({
        ...ORDINE,
        lines: [{ description: "Quattro stagioni", quantity: 1, unitPrice: 9.5, requestedAs: "capricciosa" }],
        total: 9.5,
      }),
    );

    const riga = inseriti.find((i) => i.tabella === "order_item");
    expect(String(riga?.valori.notes)).toContain("Richiesto come: capricciosa");
  });

  it("⚠️ says nothing when the words agree, instead of repeating the item", async () => {
    // "Asked for as: Margherita" under a line reading "Margherita" is noise, and noise is
    // what stops people reading the very lines that would have had something to say.
    await POST(
      richiesta({
        ...ORDINE,
        lines: [{ description: "Margherita", quantity: 1, unitPrice: 6.5, requestedAs: "margherita" }],
        total: 6.5,
      }),
    );

    expect(inseriti.find((i) => i.tabella === "order_item")?.valori.notes).toBeNull();
  });

  it("creates the customer when there is none, and leaves the lead alone", async () => {
    contatti = [];

    const risposta = await POST(richiesta(ORDINE));

    expect(risposta.status).toBe(201);
    const contatto = inseriti.find((i) => i.tabella === "contact");
    expect(contatto?.valori.firstName).toBe("Anna");
    expect(inseriti.some((i) => i.tabella === "lead")).toBe(false);
    expect(regole).toMatchObject([{ entityType: "contact", event: "onCreate" }]);
  });

  it("does not create a second customer for somebody already known", async () => {
    await POST(richiesta(ORDINE));

    expect(inseriti.some((i) => i.tabella === "contact")).toBe(false);
    expect(regole).toHaveLength(0);
  });

  it("⚠️⚠️ writes what has to be known to prepare it, where whoever prepares it looks", async () => {
    // Collection or delivery, for when, to what address. Without it the order appears with
    // the right lines and nobody knows whether to deliver it — and a note on the contact
    // would be "somewhere else", which is exactly what whoever works an order must not do.
    await POST(richiesta({ ...ORDINE, address: "via Roma 10" }));

    const note = String(inseriti.find((i) => i.tabella === "order")?.valori.notes ?? "");
    expect(note).toContain("Consegna: ritiro");
    expect(note).toContain("Per quando: alle 20:30");
    expect(note).toContain("Indirizzo: via Roma 10");
  });

  it("⚠️ leaves the note empty rather than writing labels with nothing after them", async () => {
    // "Delivery:" followed by nothing is worse than nothing: the reader assumes the
    // dato per un guasto, e va a cercarlo.
    await POST(richiesta({ ...ORDINE, fulfillment: "", when: "", address: "" }));

    expect(inseriti.find((i) => i.tabella === "order")?.valori.notes).toBeNull();
  });

  it("tells the CRM's own listeners that an order arrived", async () => {
    await POST(richiesta(ORDINE));

    expect(eventi).toEqual(["order.created"]);
  });

  it("refuses a line without a price, instead of pricing it at zero", async () => {
    const risposta = await POST(
      richiesta({ ...ORDINE, lines: [{ description: "Margherita", quantity: 1 }], total: 0 }),
    );

    expect(risposta.status).toBe(422);
    expect(inseriti).toHaveLength(0);
  });

  it("refuses an order with no lines", async () => {
    const risposta = await POST(richiesta({ ...ORDINE, lines: [], total: 0 }));

    expect(risposta.status).toBe(422);
    expect(inseriti).toHaveLength(0);
  });

  it("refuses a contact point that is neither an email nor a phone number", async () => {
    const risposta = await POST(richiesta({ ...ORDINE, contactPoint: "Anna" }));

    expect(risposta.status).toBe(422);
    expect(inseriti).toHaveLength(0);
  });
});

describe("la campanella dell'ordine", () => {
  it("⚠️⚠️ avvisa chi manda avanti l'attività: un ordine non suonava niente", async () => {
    inseriti.length = 0;
    amministratori = [{ id: "u1" }, { id: "u2" }];

    await POST(richiesta(ORDINE));
    await new Promise((r) => setTimeout(r, 0));

    // ⚠️ One call with **a list of rows**: the shape the double records, and also the shape
    // the CRM uses elsewhere to notify several people at once.
    const scritte = inseriti.filter((r) => r.tabella === "notification");
    expect(scritte).toHaveLength(1);
    const avvisi = scritte[0].valori as unknown as Record<string, unknown>[];
    expect(avvisi).toHaveLength(2);
    expect(avvisi.map((a) => a.userId).sort()).toEqual(["u1", "u2"]);
    expect(String(avvisi[0].type)).toBe("order_created");
    // The link goes to the order, not to the list: whoever receives it must be able to open it.
    expect(String(avvisi[0].link)).toContain("/dashboard/sales/orders/");
  });

  it("⚠️ senza nessun destinatario non scrive righe vuote", async () => {
    inseriti.length = 0;
    amministratori = [];

    const risposta = await POST(richiesta(ORDINE));
    await new Promise((r) => setTimeout(r, 0));

    // The order stays written: the notification is an extra, and cannot bring it down.
    expect(risposta.status).toBe(201);
    expect(inseriti.filter((r) => r.tabella === "notification")).toHaveLength(0);
    expect(inseriti.some((r) => r.tabella === "order")).toBe(true);
  });
});
