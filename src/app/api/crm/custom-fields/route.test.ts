/**
 * The route that receives what the assistant collected, and the guarantees that hold.
 *
 * ⚠️⚠️ **It writes into the custom fields this CRM already has.** The first design added
 * a jsonb column to `lead` and to `contact`: a second place for the same thing, and the day
 * the two diverged a field renamed on screen would stop matching what the assistant writes.
 *
 * ⚠️⚠️ And it **sets the rules off**, which is the entire point: without that the values
 * arrive and nothing happens — the state of affairs before, with more code in it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const regole: { entityType: string; event: string; oldData: unknown; newData: unknown }[] = [];
/** The definitions the CRM already has, by slug. */
let definizioni: { id: string; slug: string; entityType: string }[] = [];
/** I valori scritti, per `fieldId`. */
let valori: { id: string; fieldId: string; value: string }[] = [];
const creati: { name: string; slug: string; entityType: string; fieldType: string }[] = [];
let person: { leadIds: string[]; contactIds: string[] } = { leadIds: ["l1"], contactIds: [] };

vi.mock("@/lib/billing/usage", () => ({
  checkAndTrackApiCall: async () => undefined,
  EntitlementError: class extends Error {},
}));
vi.mock("@/components/crm/automation/rule-engine", () => ({
  runAutomations: async (ctx: { entityType: string; event: string; oldData: unknown; newData: unknown }) => {
    regole.push(ctx);
  },
}));
vi.mock("next/server", async () => {
  const vero = await vi.importActual<typeof import("next/server")>("next/server");
  // `after` runs immediately here: what matters is **that the rules fire**, not when — and
  // deferred work the test never waits for would turn a route that never fires them green.
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

/**
 * A fake handle that tells the two tables apart by the **shape of the selection**.
 *
 * ⚠️ It declares what it returns for each: a double answering everything with an empty
 * list would turn a route that writes nothing green.
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
        // ⚠️ Told apart by the **shape of the row** rather than by the table object: how
        // drizzle exposes its own name is its business, and a double that leaned on it
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

function richiesta(body: unknown) {
  return new Request("https://x.test/api/crm/custom-fields", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    // biome-ignore lint/suspicious/noExplicitAny: NextRequest is a Request at runtime
  }) as any;
}

beforeEach(() => {
  regole.length = 0;
  creati.length = 0;
  definizioni = [];
  valori = [];
  person = { leadIds: ["l1"], contactIds: [] };
});

describe("what happens to the collected values", () => {
  it("⚠️⚠️ writes into the custom fields this CRM already has", async () => {
    // Not a column of our own: the definitions and the values exist, and the settings
    // screen already manages them.
    const risposta = await POST(richiesta({ contactPoint: "+39 333 111 2223", fields: { budget: "8000" } }));

    expect(risposta.status).toBe(200);
    expect(valori).toHaveLength(1);
    expect(valori[0].value).toBe("8000");
  });

  it("⚠️ creates the definition the owner already declared in the assistant", async () => {
    // Refusing would mean declaring the same field twice, in two products, before the
    // first conversation can work at all — and the refusal would arrive as a 422 nobody can
    // act on quickly.
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
    // A lead "budget" and a contact "budget" are two separate definitions: reusing the
    // first on a contact would attach the value to a field the contact screens never read,
    // and the owner would see it empty despite having been given it.
    definizioni = [{ id: "def-dei-lead", slug: "budget", entityType: "lead" }];
    person = { leadIds: [], contactIds: ["c1"] };

    await POST(richiesta({ contactPoint: "mario@example.it", fields: { budget: "8000" } }));

    expect(creati).toHaveLength(1);
    expect(creati[0].entityType).toBe("contact");
    expect(valori[0].fieldId).not.toBe("def-dei-lead");
  });

  it("⚠️⚠️ runs the owner's rules, with the values before and after", async () => {
    // The reason this route exists: thresholds and segments live where the fields to
    // judge them live, and this is the moment one of those fields arrives to be judged.
    await POST(richiesta({ contactPoint: "+39 333 111 2223", fields: { budget: "8000" } }));

    expect(regole).toHaveLength(1);
    expect(regole[0].entityType).toBe("lead");
    expect(regole[0].event).toBe("onUpdate");
    // ⚠️ `customFields` is the path a condition is written against: `customFields.budget`.
    // A firing that left them out would quietly make every rule of that kind false.
    expect((regole[0].oldData as Record<string, unknown>).customFields).toEqual({});
    expect((regole[0].newData as Record<string, unknown>).customFields).toEqual({ budget: "8000" });
  });

  it("⚠️ the contact wins over the lead, like a note does", async () => {
    person = { leadIds: ["l1"], contactIds: ["c1"] };

    await POST(richiesta({ contactPoint: "mario@example.it", fields: { budget: "8000" } }));

    expect(regole[0].entityType).toBe("contact");
    expect(creati[0].entityType).toBe("contact");
  });

  it("keeps only named values that a rule could compare", async () => {
    // A nested object is a shape no condition can compare, and the caller has no way to
    // learn that from a silent success.
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
    // An assistant that believes it recorded what it collected, onto a row that does not
    // exist, is worse than one that knows it failed.
    person = { leadIds: [], contactIds: [] };

    const risposta = await POST(richiesta({ contactPoint: "+39 333 111 2223", fields: { budget: "1" } }));

    expect(risposta.status).toBe(404);
    expect(valori).toHaveLength(0);
    expect(regole).toHaveLength(0);
  });

  it("refuses a body without usable fields instead of touching anything", async () => {
    for (const body of [
      { contactPoint: "+39 333 111 2223" },
      { contactPoint: "+39 333 111 2223", fields: {} },
      { contactPoint: "+39 333 111 2223", fields: [] },
      { fields: { budget: "1" } },
      { contactPoint: "mario", fields: { budget: "1" } },
    ]) {
      const risposta = await POST(richiesta(body));
      expect(risposta.status).toBe(422);
    }
    expect(valori).toHaveLength(0);
    expect(creati).toHaveLength(0);
    expect(regole).toHaveLength(0);
  });
});
