/**
 * The route that receives "this person does not want to be contacted any more".
 *
 * ⚠️⚠️ **The refusal is about the person, not the record.** Silencing the contact and
 * leaving the lead subscribed would keep that person in exactly the audience they asked to
 * leave, and neither product would notice: from here the campaign goes out, over there the
 * assistant believes it honoured the refusal.
 *
 * ⚠️ **And it writes only on whoever was still subscribed.** The step that calls this
 * route is deliberately idempotent and gets retried: writing `false` over `false` would run
 * the owner's rules again on a change that never happened, and anybody with a rule saying
 * "tell me when somebody unsubscribes" would be told on every attempt.
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
  // ⚠️ The double **declares the table** rather than always returning the same rows: the
  // guarantee under test is that both of the person's records are silenced, and a double
  // that cannot tell a lead from a contact would make it unverifiable.
  createTenantDb: () => ({
    select: () => ({
      from: (tabella: unknown) => ({
        where: async () => (tabella === leads ? righeLead : righeContatti),
      }),
    }),
    update: (tabella: unknown) => ({
      set: (valori: Record<string, unknown>) => {
        // ⚠️ **Both** tables are named: with an implicit `else` a write landing on a third
        // table would be recorded as "contact", and the mutation that leaves the contact
        // subscribed would survive.
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
    // The calling step is retried: writing `false` over `false` would set off
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
    // ⚠️ The message is the guarantee, not the status code: without the guard the refusal
    // still arrives, but says "neither an email nor a number" about a field that was never
    // sent at all — and the integrator goes looking for a format error that does not exist.
    // It is the same shape of refusal the other routes give, and must stay the same.
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
