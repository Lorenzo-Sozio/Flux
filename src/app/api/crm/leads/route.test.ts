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
const regole: { tenantId: string; ctx: Record<string, unknown> }[] = [];
const scritti: { op: "insert" | "update"; values: Record<string, unknown> }[] = [];

vi.mock("@/lib/webhook-dispatch", () => ({
  dispatchWebhook: (evento: string, _p: unknown, origin: unknown) => {
    emessi.push({ evento, origin });
  },
}));
vi.mock("@/lib/api-automations", () => ({
  runRulesAfterApiWrite: (tenantId: string, ctx: Record<string, unknown>) => {
    regole.push({ tenantId, ctx });
  },
}));
vi.mock("@/lib/api-import-auth", () => ({
  gateApiRequest: async () => ({
    auth: {
      via: "apikey",
      userId: null,
      role: "editor",
      tenantId: "t1",
      scopes: null,
      key: { id: "k1", name: "Assistente" },
    },
  }),
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
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        scritti.push({ op: "insert", values });
        return { returning: async () => [{ id: "nuovo" }] };
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        scritti.push({ op: "update", values });
        return { where: () => ({ returning: async () => [{ id: "vecchio" }] }) };
      },
    }),
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
  regole.length = 0;
  scritti.length = 0;
  esistente = [];
});

describe("⚠️⚠️ where the lead came from, when the API writes it again", () => {
  it('is "api" for a lead the API creates without saying', async () => {
    await POST(richiesta({ phone: "+39 333 111 2223" }));
    expect(scritti[0]).toMatchObject({ op: "insert", values: { source: "api" } });
  });

  it("⚠️⚠️ stays what it was when a duplicate is updated without one", async () => {
    // A lead from Meta ads, sent again by Zapier without a source, used to become an "api"
    // lead, and the report by source moved it to the wrong channel.
    esistente = [{ id: "gia-la" }];
    await POST(richiesta({ phone: "+39 333 111 2223", onDuplicate: "update" }));
    expect(scritti[0].op).toBe("update");
    expect(scritti[0].values.source).toBeUndefined();
  });

  it("is written when the update says it", async () => {
    esistente = [{ id: "gia-la" }];
    await POST(richiesta({ phone: "+39 333 111 2223", source: "ads_meta", onDuplicate: "update" }));
    expect(scritti[0]).toMatchObject({ op: "update", values: { source: "ads_meta" } });
  });
});

describe("who the events from this route say caused them", () => {
  it("⚠️⚠️ says a machine when a lead is created", async () => {
    await POST(richiesta({ phone: "+39 333 111 2223" }));

    expect(emessi).toHaveLength(1);
    expect(emessi[0].evento).toBe("lead.created");
    expect(emessi[0].origin).toEqual({ via: "api", actor: null, key: { id: "k1", name: "Assistente" } });
  });

  it("says a machine when a duplicate is updated instead", async () => {
    // The same holds on the route's other exit: forgetting one was enough for the echo to
    // come back in half the cases — which is worse, because it appears intermittently.
    esistente = [{ id: "gia-la" }];

    await POST(richiesta({ email: "anna@example.test", onDuplicate: "update" }));

    expect(emessi[0].evento).toBe("lead.updated");
    expect(emessi[0].origin).toEqual({ via: "api", actor: null, key: { id: "k1", name: "Assistente" } });
  });
});

describe("⚠️⚠️ the workspace's rules run for a lead the API writes", () => {
  // A lead typed into the dashboard gets its round-robin owner, its sequence and its
  // notification from the rules. One filed by an assistant got none of them: the route
  // never asked, and the four routes that did asked outside the workspace.
  it("on a creation, in the caller's workspace", async () => {
    await POST(richiesta({ phone: "+39 333 111 2223" }));

    expect(regole).toHaveLength(1);
    expect(regole[0].tenantId).toBe("t1");
    expect(regole[0].ctx).toMatchObject({ entityType: "lead", entityId: "nuovo", event: "onCreate" });
  });

  it("on an update, with the row as it was", async () => {
    esistente = [{ id: "gia-la" }];

    await POST(richiesta({ email: "anna@example.test", onDuplicate: "update" }));

    expect(regole).toHaveLength(1);
    expect(regole[0].ctx).toMatchObject({ event: "onUpdate", entityId: "vecchio", oldData: { id: "gia-la" } });
  });

  it("not for a duplicate that was skipped: nothing changed", async () => {
    esistente = [{ id: "gia-la" }];

    await POST(richiesta({ email: "anna@example.test" }));

    expect(regole).toEqual([]);
  });
});
