/**
 * The route that creates a lead, and the line that stops the echo at its source.
 *
 * ⚠️ One value is defended here and it is not visible from reading the route: that every
 * event leaving **this** door declares a machine caused it. Without that, the integration
 * which has just written the lead receives its own event, reacts to it, and
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

function richiesta(body: Record<string, unknown>) {
  return new Request("https://x.test/api/crm/leads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
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
    // The same holds on the route's other exit: forgetting one was enough for the echo to
    // come back in half the cases — which is worse, because it appears intermittently.
    esistente = [{ id: "gia-la" }];

    await POST(richiesta({ email: "anna@example.test", onDuplicate: "update" }));

    expect(emessi[0].evento).toBe("lead.updated");
    expect(emessi[0].origin).toEqual({ via: "api", actor: null });
  });
});
