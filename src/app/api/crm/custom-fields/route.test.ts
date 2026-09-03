/**
 * La rotta che riceve quello che l'assistente ha raccolto, e le garanzie che valgono.
 *
 * ⚠️⚠️ **Scrive nei campi personalizzati che questo CRM ha già.** Il primo disegno
 * aggiungeva una colonna jsonb su `lead` e su `contact`: era un secondo posto per la stessa
 * cosa, e il giorno in cui divergessero il campo rinominato nella schermata smetterebbe di
 * combaciare con quello che l'assistente scrive.
 *
 * ⚠️⚠️ E **fa scattare le regole**, che è l'intero punto: senza, i valori arrivano e non
 * succede niente — cioè lo stato di prima, con più codice.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const regole: { entityType: string; event: string; oldData: unknown; newData: unknown }[] = [];
/** Le definizioni che il CRM ha già, per slug. */
let definizioni: { id: string; slug: string; entityType: string }[] = [];
/** I valori scritti, per `fieldId`. */
let valori: { id: string; fieldId: string; value: string }[] = [];
const creati: { name: string; slug: string; entityType: string; fieldType: string }[] = [];
let persona: { leadIds: string[]; contactIds: string[] } = { leadIds: ["l1"], contactIds: [] };

vi.mock("@/components/crm/automation/rule-engine", () => ({
  runAutomations: async (ctx: { entityType: string; event: string; oldData: unknown; newData: unknown }) => {
    regole.push(ctx);
  },
}));
vi.mock("next/server", async () => {
  const vero = await vi.importActual<typeof import("next/server")>("next/server");
  // `after` esegue subito: qui interessa **che le regole partano**, non quando — e un
  // programma differito che il test non aspetta renderebbe verde una rotta che non le lancia.
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

/**
 * Un finto handle che distingue le due tabelle dalla **forma della selezione**.
 *
 * ⚠️ Dichiara che cosa restituisce per ognuna: un doppio che rispondesse con un elenco
 * vuoto a tutto renderebbe verde una rotta che non scrive niente.
 */
vi.mock("@/db", () => ({
  createTenantDb: () => ({
    select: (colonne: Record<string, unknown>) => ({
      from: () => ({
        where: async () => {
          if ("slug" in colonne) return definizioni;
          if ("fieldId" in colonne) return valori.map((v) => ({ fieldId: v.fieldId, value: v.value }));
          return valori.length > 0 ? [{ id: valori[0].id }] : [];
        },
      }),
    }),
    insert: () => ({
      values: (riga: Record<string, unknown>) => {
        // ⚠️ Si distingue dalla **forma della riga** e non dall'oggetto tabella: come
        // drizzle esponga il proprio nome è un dettaglio suo, e un doppio che ci si
        // appoggiasse smetterebbe di distinguere le due tabelle al primo aggiornamento —
        // silenziosamente, mandando le definizioni fra i valori.
        if ("slug" in riga) {
          creati.push(riga as never);
          const id = `def-${riga.slug}`;
          definizioni = [...definizioni, { id, slug: String(riga.slug), entityType: String(riga.entityType) }];
          return { returning: async () => [{ id }] };
        }
        valori = [...valori, { id: `val-${valori.length}`, fieldId: String(riga.fieldId), value: String(riga.value) }];
        return { returning: async () => [{ id: `val-${valori.length}` }] };
      },
    }),
    update: () => ({
      set: (valore: Record<string, unknown>) => ({
        where: () => {
          valori = valori.map((v) => ({ ...v, value: String(valore.value ?? v.value) }));
          return Promise.resolve();
        },
      }),
    }),
  }),
}));

const { POST } = await import("@/app/api/crm/custom-fields/route");

function richiesta(corpo: unknown) {
  return new Request("https://x.test/api/crm/custom-fields", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(corpo),
    // biome-ignore lint/suspicious/noExplicitAny: NextRequest is a Request at runtime
  }) as any;
}

beforeEach(() => {
  regole.length = 0;
  creati.length = 0;
  definizioni = [];
  valori = [];
  persona = { leadIds: ["l1"], contactIds: [] };
});

describe("what happens to the collected values", () => {
  it("⚠️⚠️ writes into the custom fields this CRM already has", async () => {
    // Non una colonna nostra: le definizioni e i valori esistono, e la schermata delle
    // impostazioni li gestisce già.
    const risposta = await POST(richiesta({ contactPoint: "+39 333 111 2223", fields: { budget: "8000" } }));

    expect(risposta.status).toBe(200);
    expect(valori).toHaveLength(1);
    expect(valori[0].value).toBe("8000");
  });

  it("⚠️ creates the definition the owner already declared in the assistant", async () => {
    // Rifiutare vorrebbe dire dichiarare lo stesso campo due volte, in due prodotti, prima
    // che la prima conversazione possa funzionare — e il rifiuto arriverebbe come un 422 su
    // cui nessuno può agire in fretta.
    await POST(richiesta({ contactPoint: "+39 333 111 2223", fields: { metratura: "80 mq" } }));

    expect(creati).toHaveLength(1);
    expect(creati[0]).toMatchObject({ slug: "metratura", entityType: "lead", fieldType: "text" });
  });

  it("reuses a definition that exists instead of making a second one", async () => {
    definizioni = [{ id: "def-esistente", slug: "budget", entityType: "lead" }];

    await POST(richiesta({ contactPoint: "+39 333 111 2223", fields: { budget: "8000" } }));

    expect(creati).toHaveLength(0);
    expect(valori[0].fieldId).toBe("def-esistente");
  });

  it("⚠️ does NOT reuse a definition declared for another entity", async () => {
    // Un «budget» dei lead e un «budget» dei contatti sono due definizioni distinte:
    // riusare la prima su un contatto attaccherebbe il valore a un campo che le schermate
    // dei contatti non interrogano, e il titolare lo vedrebbe vuoto pur avendolo ricevuto.
    definizioni = [{ id: "def-dei-lead", slug: "budget", entityType: "lead" }];
    persona = { leadIds: [], contactIds: ["c1"] };

    await POST(richiesta({ contactPoint: "mario@example.it", fields: { budget: "8000" } }));

    expect(creati).toHaveLength(1);
    expect(creati[0].entityType).toBe("contact");
    expect(valori[0].fieldId).not.toBe("def-dei-lead");
  });

  it("⚠️⚠️ runs the owner's rules, with the values before and after", async () => {
    // È la ragione per cui questa rotta esiste: soglie e segmenti vivono dove vivono i
    // campi per valutarli, e questo è il momento in cui ne ricevono uno da valutare.
    await POST(richiesta({ contactPoint: "+39 333 111 2223", fields: { budget: "8000" } }));

    expect(regole).toHaveLength(1);
    expect(regole[0].entityType).toBe("lead");
    expect(regole[0].event).toBe("onUpdate");
    // ⚠️ `customFields` è il percorso che una condizione scrive: `customFields.budget`.
    // Uno scatto che li omettesse renderebbe silenziosamente falsa ogni regola di quel tipo.
    expect((regole[0].oldData as Record<string, unknown>).customFields).toEqual({});
    expect((regole[0].newData as Record<string, unknown>).customFields).toEqual({ budget: "8000" });
  });

  it("⚠️ the contact wins over the lead, like a note does", async () => {
    persona = { leadIds: ["l1"], contactIds: ["c1"] };

    await POST(richiesta({ contactPoint: "mario@example.it", fields: { budget: "8000" } }));

    expect(regole[0].entityType).toBe("contact");
    expect(creati[0].entityType).toBe("contact");
  });

  it("keeps only named values that a rule could compare", async () => {
    // Un oggetto annidato è una forma che nessuna condizione sa confrontare, e chi chiama
    // non ha modo di scoprirlo da un successo silenzioso.
    const risposta = await POST(
      richiesta({
        contactPoint: "+39 333 111 2223",
        fields: { budget: "8000", quando: { fra: 2 }, vuoto: "   ", numero: 3 },
      }),
    );

    expect(risposta.status).toBe(200);
    expect(creati.map((c) => c.slug).sort()).toEqual(["budget", "numero"]);
  });

  it("⚠️ nobody reachable is a 404, and nothing is written", async () => {
    // Un assistente che crede di aver registrato quello che ha raccolto, su una riga che non
    // esiste, è peggio di uno che sa di non avercela fatta.
    persona = { leadIds: [], contactIds: [] };

    const risposta = await POST(richiesta({ contactPoint: "+39 333 111 2223", fields: { budget: "1" } }));

    expect(risposta.status).toBe(404);
    expect(valori).toHaveLength(0);
    expect(regole).toHaveLength(0);
  });

  it("refuses a body without usable fields instead of touching anything", async () => {
    for (const corpo of [
      { contactPoint: "+39 333 111 2223" },
      { contactPoint: "+39 333 111 2223", fields: {} },
      { contactPoint: "+39 333 111 2223", fields: [] },
      { fields: { budget: "1" } },
      { contactPoint: "mario", fields: { budget: "1" } },
    ]) {
      const risposta = await POST(richiesta(corpo));
      expect(risposta.status).toBe(422);
    }
    expect(valori).toHaveLength(0);
    expect(creati).toHaveLength(0);
    expect(regole).toHaveLength(0);
  });
});
