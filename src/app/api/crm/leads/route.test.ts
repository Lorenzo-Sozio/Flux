/**
 * La rotta che crea un lead, e la riga che ferma l'eco alla fonte.
 *
 * ⚠️ Il valore difeso qui è uno solo, e non si vede leggendo la rotta: che ogni evento
 * emesso da **questa** porta dichiari di essere stato causato da una macchina. Senza,
 * l'integrazione che ha appena scritto il lead riceve il proprio evento, ci reagisce, e
 * non smette.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const emessi: { evento: string; origin: unknown }[] = [];
let esistente: { id: string }[] = [];

vi.mock("@/actions/webhooks", () => ({
  dispatchWebhook: (evento: string, _p: unknown, origin: unknown) => {
    emessi.push({ evento, origin });
  },
}));
vi.mock("@/lib/api-import-auth", () => ({
  authenticateApiRequest: async () => ({ via: "apikey", userId: null, role: "editor", tenantId: "t1" }),
}));
vi.mock("@/lib/get-tenant", () => ({ getTenantById: async () => ({ id: "t1", dbUrl: "x" }) }));
vi.mock("@/lib/tenant-db", () => ({ decryptDbUrl: () => "postgres://finto" }));
vi.mock("@/lib/billing/usage", () => ({
  checkAndTrackApiCall: async () => undefined,
  EntitlementError: class extends Error {},
}));
vi.mock("@/db", () => ({
  createTenantDb: () => ({
    select: () => ({ from: () => ({ where: async () => esistente }) }),
    insert: () => ({ values: () => ({ returning: async () => [{ id: "nuovo" }] }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: async () => [{ id: "vecchio" }] }) }) }),
  }),
}));

const { POST } = await import("@/app/api/crm/leads/route");

function richiesta(corpo: Record<string, unknown>) {
  return new Request("https://x.test/api/crm/leads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(corpo),
    // biome-ignore lint/suspicious/noExplicitAny: NextRequest is a Request at runtime
  }) as any;
}

beforeEach(() => {
  emessi.length = 0;
  esistente = [];
});

describe("who the events from this route say caused them", () => {
  it("⚠️⚠️ says a machine when a lead is created", async () => {
    await POST(richiesta({ phone: "+39 333 111 2223" }));

    expect(emessi).toHaveLength(1);
    expect(emessi[0].evento).toBe("lead.created");
    expect(emessi[0].origin).toEqual({ via: "api", actor: null });
  });

  it("says a machine when a duplicate is updated instead", async () => {
    // Lo stesso vale sull'altra uscita della rotta: bastava dimenticarne una perché l'eco
    // tornasse per metà dei casi — che è peggio, perché si manifesta a intermittenza.
    esistente = [{ id: "gia-la" }];

    await POST(richiesta({ email: "anna@example.test", onDuplicate: "update" }));

    expect(emessi[0].evento).toBe("lead.updated");
    expect(emessi[0].origin).toEqual({ via: "api", actor: null });
  });
});
