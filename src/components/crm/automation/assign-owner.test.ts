/**
 * The automation action that hands a record to the next person in turn.
 *
 * ⚠️⚠️ Every failure here looks like a working assignment. A lead handed to a
 * salesperson who left, a lead taken off the person who had just claimed it, a
 * turn skipped because the record was already owned: the rule's log says
 * "executed" each time.
 *
 * The fake database below evaluates the WHERE conditions against its rows instead
 * of recording that a method was called, so the conditional write is tested for
 * what it does: a hand assignment that lands first must survive.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Cond =
  | { op: "eq"; col: string; val: unknown }
  | { op: "isNull"; col: string }
  | { op: "inArray"; col: string; vals: unknown[] }
  | { op: "and"; parts: Cond[] };

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ op: "eq", col, val }),
  isNull: (col: string) => ({ op: "isNull", col }),
  inArray: (col: string, vals: unknown[]) => ({ op: "inArray", col, vals }),
  and: (...parts: Cond[]) => ({ op: "and", parts }),
  sql: () => ({ op: "sql" }),
}));

function table(name: string, cols: string[]) {
  return Object.fromEntries([["__table", name], ...cols.map((c) => [c, `${name}.${c}`])]);
}
vi.mock("@/db/schema", () => {
  const t = (name: string) => table(name, ["id", "ownerId", "updatedAt"]);
  return {
    companies: t("companies"),
    contacts: t("contacts"),
    deals: t("deals"),
    leads: t("leads"),
    orders: t("orders"),
    tickets: t("tickets"),
    emailTemplates: {},
    notifications: {},
    tasks: {},
    tenantMembers: table("tenantMembers", ["tenantId", "userId"]),
  };
});

type Row = Record<string, unknown>;
const rows: Record<string, Row[]> = {};
const writes: { table: string; set: Row }[] = [];

function matches(row: Row, cond: Cond): boolean {
  const field = (col: string) => col.split(".")[1];
  switch (cond.op) {
    case "eq":
      return row[field(cond.col)] === cond.val;
    case "isNull":
      return row[field(cond.col)] == null;
    case "inArray":
      return cond.vals.includes(row[field(cond.col)]);
    case "and":
      return cond.parts.every((p) => matches(row, p));
  }
}

function fakeDb() {
  return {
    select: () => ({
      from: (t: { __table: string }) => ({
        where: async (cond: Cond) => (rows[t.__table] ?? []).filter((r) => matches(r, cond)).map((r) => ({ ...r })),
      }),
    }),
    update: (t: { __table: string }) => ({
      set: (set: Row) => ({
        where: (cond: Cond) => ({
          returning: async () => {
            const hit = (rows[t.__table] ?? []).filter((r) => matches(r, cond));
            for (const r of hit) Object.assign(r, set);
            if (hit.length) writes.push({ table: t.__table, set });
            return hit.map((r) => ({ id: r.id }));
          },
        }),
      }),
    }),
  };
}

let turn = 0;
// Runs when the rule takes its turn: after it has read the record, before it writes.
let betweenReadAndWrite: (() => void) | null = null;
const scopes: string[] = [];
const notified: { userId: string; type: string; message: string; link?: string }[] = [];
const cascaded: { event: string; oldData: Row; newData: Row }[] = [];
let tenantId: string | null = "t1";

vi.mock("@/db", () => ({ platformDb: fakeDb() }));
vi.mock("@/lib/tenant-context", () => ({
  getDb: async () => fakeDb(),
  getCurrentTenantId: async () => tenantId,
}));
vi.mock("@/lib/document-counter", () => ({
  nextInSequence: async (_db: unknown, scope: string) => {
    scopes.push(scope);
    betweenReadAndWrite?.();
    return ++turn;
  },
}));
vi.mock("@/lib/notify", () => ({
  notify: async (n: { userId: string; type: string; message: string; link?: string }) => {
    notified.push(n);
  },
}));
vi.mock("../../crm/automation/rule-engine", () => ({
  runAutomations: async (c: { event: string; oldData: Row; newData: Row }) => {
    cascaded.push(c);
  },
}));
vi.mock("@/actions/webhooks", () => ({ dispatchWebhook: async () => undefined }));
vi.mock("../../crm/automation/webhook-service", () => ({ sendWebhook: async () => ({}) }));
vi.mock("../../crm/automation/email-service", () => ({ sendAutomationEmailWithContext: async () => ({}) }));
vi.mock("../../crm/automation/loop-detector", () => ({}));

const { ActionDispatcher } = await import("./action-dispatcher");

const TEAM = ["anna", "bruno", "carla"];

function assign(params: Partial<{ userIds: string[]; overwrite: boolean }> = {}) {
  return {
    type: "assign_owner" as const,
    params: { strategy: "round_robin" as const, userIds: TEAM, overwrite: false, ...params },
  };
}

function lead(id: string, ownerId: string | null = null) {
  rows.leads.push({ id, ownerId, firstName: "Mario", lastName: "Rossi" });
  return { entityType: "lead", entityId: id, event: "onCreate" as const, newData: {}, currentUserId: "u0" };
}

const inRule = (ruleId = "rule-1") => ({
  ruleChain: [{ ruleId, timestamp: 0 }],
  processedEntities: new Set<string>(),
  depth: 1,
});

// dispatch is private: dispatchAll would turn every refusal below into a logged
// lastError, and a refusal is exactly what several of these tests assert.
const run = (action: unknown, ctx: unknown, exec: unknown) =>
  // biome-ignore lint/suspicious/noExplicitAny: reaching the private entry point
  (new ActionDispatcher() as any).dispatch(action, ctx, exec);
const ownerOf = (id: string) => rows.leads.find((r) => r.id === id)?.ownerId;

beforeEach(() => {
  for (const k of Object.keys(rows)) delete rows[k];
  rows.leads = [];
  rows.deals = [];
  rows.tenantMembers = TEAM.map((userId) => ({ tenantId: "t1", userId }));
  writes.length = 0;
  scopes.length = 0;
  notified.length = 0;
  cascaded.length = 0;
  turn = 0;
  betweenReadAndWrite = null;
  tenantId = "t1";
});

describe("sharing out new leads", () => {
  it("⚠️⚠️ gives consecutive leads to consecutive people", async () => {
    for (const id of ["l1", "l2", "l3", "l4"]) await run(assign(), lead(id), inRule());
    expect(["l1", "l2", "l3", "l4"].map(ownerOf)).toEqual(["anna", "bruno", "carla", "anna"]);
  });

  it("⚠️ advances the rule's own rotation, not a shared one", async () => {
    await run(assign(), lead("l1"), inRule("rule-42"));
    expect(scopes).toEqual(["round-robin:rule-42"]);
  });

  it("tells the new owner, with a link to the lead", async () => {
    await run(assign(), lead("l1"), inRule());
    expect(notified).toEqual([
      expect.objectContaining({
        userId: "anna",
        type: "lead_assigned",
        message: "Mario Rossi has been assigned to you.",
        link: "/dashboard/leads/l1",
      }),
    ]);
  });

  it("⚠️ lets other rules react to the new owner, as any update would", async () => {
    await run(assign(), lead("l1"), inRule());
    expect(cascaded).toHaveLength(1);
    expect(cascaded[0].event).toBe("onUpdate");
    expect(cascaded[0].oldData.ownerId).toBeNull();
    expect(cascaded[0].newData.ownerId).toBe("anna");
  });

  it("assigns deals too, without a lead notification", async () => {
    rows.deals.push({ id: "d1", ownerId: null });
    await run(assign(), { entityType: "deal", entityId: "d1", event: "onCreate", newData: {} }, inRule());
    expect(rows.deals[0].ownerId).toBe("anna");
    expect(notified).toHaveLength(0);
  });
});

describe("a record somebody already owns", () => {
  it("⚠️⚠️ is left with them, and nobody's turn is used up", async () => {
    await run(assign(), lead("l1", "zeno"), inRule());
    expect(ownerOf("l1")).toBe("zeno");
    expect(scopes, "a turn was taken for a lead that was not assigned").toHaveLength(0);

    await run(assign(), lead("l2"), inRule());
    expect(ownerOf("l2"), "the skipped lead cost anna her turn").toBe("anna");
  });

  it("is reassigned when the rule says to overwrite", async () => {
    await run(assign({ overwrite: true }), lead("l1", "zeno"), inRule());
    expect(ownerOf("l1")).toBe("anna");
  });

  it("⚠️⚠️ keeps a hand assignment that lands between the read and the write", async () => {
    const ctx = lead("l1");
    betweenReadAndWrite = () => {
      rows.leads[0].ownerId = "zeno";
    };
    await run(assign(), ctx, inRule());
    expect(ownerOf("l1"), "the rule overwrote somebody's claim").toBe("zeno");
    expect(notified).toHaveLength(0);
    expect(cascaded).toHaveLength(0);
  });
});

describe("who can receive", () => {
  it("⚠️⚠️ never someone who has left the workspace", async () => {
    rows.tenantMembers = [{ tenantId: "t1", userId: "carla" }];
    for (const id of ["l1", "l2"]) await run(assign(), lead(id), inRule());
    expect([ownerOf("l1"), ownerOf("l2")]).toEqual(["carla", "carla"]);
  });

  it("⚠️⚠️ never a member of a different workspace", async () => {
    rows.tenantMembers = [
      { tenantId: "t2", userId: "anna" },
      { tenantId: "t1", userId: "bruno" },
    ];
    await run(assign(), lead("l1"), inRule());
    expect(ownerOf("l1")).toBe("bruno");
  });

  it("⚠️ refuses when nobody listed is still a member, and uses no turn", async () => {
    rows.tenantMembers = [];
    await expect(run(assign(), lead("l1"), inRule())).rejects.toThrow(/still a member/);
    expect(ownerOf("l1")).toBeNull();
    expect(scopes).toHaveLength(0);
  });

  it("refuses without a workspace rather than reading everyone's members", async () => {
    tenantId = null;
    await expect(run(assign(), lead("l1"), inRule())).rejects.toThrow(/needs a workspace/);
    expect(ownerOf("l1")).toBeNull();
  });
});

describe("where it does not apply", () => {
  it("refuses a record type with no owner", async () => {
    await expect(
      run(assign(), { entityType: "ticket", entityId: "t1", event: "onCreate", newData: {} }, inRule()),
    ).rejects.toThrow(/no owner/);
  });

  it("refuses to run outside a rule, where there is no rotation", async () => {
    await expect(run(assign(), lead("l1"), { ruleChain: [], depth: 0 })).rejects.toThrow(/outside a rule/);
    expect(ownerOf("l1")).toBeNull();
  });
});

describe("saving a rule that assigns", () => {
  it("⚠️ refuses a rotation with nobody in it", async () => {
    const { ActionSchema } = await import("./types");
    expect(ActionSchema.safeParse(assign({ userIds: [] })).success).toBe(false);
  });

  it("does not reassign owned records unless told to", async () => {
    const { ActionSchema } = await import("./types");
    const parsed = ActionSchema.parse({ type: "assign_owner", params: { userIds: ["anna"] } });
    expect(parsed.params).toEqual({ strategy: "round_robin", userIds: ["anna"], overwrite: false });
  });
});
