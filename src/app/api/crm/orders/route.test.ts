/**
 * La rotta che riceve un ordine preso a voce da un assistente.
 *
 * ⚠️⚠️ **I prezzi arrivano già fatti, e questa rotta non li ricalcola dal proprio catalogo.**
 * Ogni riga porta il prezzo che l'assistente ha *pronunciato* al cliente, copiato dal listino
 * dell'attività. Ricalcolarlo qui vorrebbe dire che il giorno in cui i due cataloghi
 * divergono chi ha ordinato al telefono si sente chiedere una cifra diversa da quella che gli
 * è stata detta, e nessuno se ne accorge.
 *
 * Quello che invece si controlla è che il totale dichiarato **sia il totale delle righe
 * mandate**: due sistemi che si accordano sull'aritmetica costano poco, un ordine al prezzo
 * sbagliato no.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const inseriti: { tabella: string; valori: Record<string, unknown> }[] = [];
const regole: { entityType: string; event: string }[] = [];
const eventi: string[] = [];
let contatti: { id: string }[] = [];

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
    trova: async () => ({ leadIds: [], contactIds: contatti.map((c) => c.id), email: null, digits: null }),
  };
});
vi.mock("@/lib/order-number", () => ({ nextOrderNumber: async () => "ORD-2026-0007" }));
vi.mock("@/db", () => ({
  createTenantDb: () => ({
    insert: (tabella: { [k: string]: unknown }) => ({
      values: (valori: Record<string, unknown>) => {
        // Il nome della tabella si legge dal simbolo di drizzle: il doppio deve poter dire
        // **quale** riga è stata scritta, o «l'ordine ha creato un contatto» sarebbe
        // indistinguibile da «l'ordine ha scritto una riga qualunque».
        const nome = String((tabella as { [k: symbol]: unknown })[Symbol.for("drizzle:Name")] ?? "?");
        inseriti.push({ tabella: nome, valori });
        // ⚠️ Un **vero** Promise, non un oggetto con `then`: le righe dell'ordine si
        // attendono senza chiedere niente indietro, l'ordine e il contatto chiamano
        // `returning`. Un thenable scritto a mano farebbe la stessa cosa e sarebbe la
        // forma che questo progetto ha gia' deciso di non avere.
        const attesa = Promise.resolve(undefined) as Promise<undefined> & {
          returning: () => Promise<{ id: string; orderNumber: unknown }[]>;
        };
        attesa.returning = async () => [{ id: `${nome}-1`, orderNumber: valori.orderNumber ?? null }];
        return attesa;
      },
    }),
  }),
}));

const { POST } = await import("@/app/api/crm/orders/route");

function richiesta(corpo: unknown) {
  return new Request("https://x.test/api/crm/orders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(corpo),
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
    // Qualunque dei due lati abbia sbagliato, una delle due cifre e' quella che il cliente
    // ha sentito. Correggerla in silenzio significherebbe registrarne un'altra.
    const risposta = await POST(richiesta({ ...ORDINE, total: 18 }));

    expect(risposta.status).toBe(409);
    expect(await risposta.json()).toMatchObject({ declared: 18, computed: 21.5 });
    expect(inseriti).toHaveLength(0);
  });

  it("⚠️ writes what the customer asked to change into the line a person reads", async () => {
    // Una riga che dice «Diavola» mentre il cliente l'ha chiesta senza piccante e' un ordine
    // preparato sbagliato.
    await POST(richiesta(ORDINE));

    const righe = inseriti.filter((i) => i.tabella === "order_item");
    expect(righe[1].valori.description).toBe("Diavola (poco piccante)");
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
