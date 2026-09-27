/**
 * A workspace that has used its monthly automation runs, against a real Postgres.
 *
 * ⚠️⚠️ The rules were skipped with one `console.warn`: automations simply stopped, with
 * nothing in the log and nothing on anybody's screen, until somebody wondered why.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";

const db = drizzle(new PGlite());
const told: { userId: string; key?: string }[][] = [];

vi.mock("@/lib/tenant-context", () => ({ getDb: async () => db, getCurrentTenantId: async () => "t1" }));
vi.mock("@/lib/billing/usage", () => ({
  getUsage: async () => ({ current: 1000 }),
  incrementUsage: async () => undefined,
}));
vi.mock("@/lib/billing/licensing", () => {
  class EntitlementError extends Error {}
  return {
    EntitlementError,
    assertLimit: async () => {
      throw new EntitlementError("limit");
    },
  };
});
vi.mock("@/lib/workspace-members", () => ({ membersWith: async () => ["anna", "luca"] }));
// The dispatcher is never reached here; its imports (webhooks, platform db) need no runtime.
vi.mock("./action-dispatcher", () => ({ ActionDispatcher: class {} }));
vi.mock("@/db", () => ({ platformDb: {} }));
vi.mock("@/lib/notify", () => ({
  notify: async () => undefined,
  notifyMany: async (rows: { userId: string; key?: string }[]) => {
    told.push(rows);
  },
}));

const { runAutomations } = await import("./rule-engine");

beforeAll(async () => {
  await applyTenantMigrations(db as never);
}, 120_000);

beforeEach(async () => {
  told.length = 0;
  await db.execute(sql`delete from automation_log`);
  await db.execute(sql`delete from automation_rule`);
  await db.execute(sql`
    insert into automation_rule (id, name, target_entity, trigger_on, conditions, condition_logic, actions, is_active)
    values ('r1', 'Regola', 'deal', ARRAY['onUpdate']::text[], '[]', 'AND', '[]', true)`);
});

const event = { entityType: "deal", entityId: "d1", event: "onUpdate", oldData: {}, newData: {} } as const;

describe("⚠️⚠️ when the monthly runs are used up", () => {
  it("each skipped rule leaves a line in the log, and the managers are told", async () => {
    await runAutomations(event);

    const rows = (await db.execute(sql`select rule_id, success, error_message from automation_log`)).rows as Record<
      string,
      unknown
    >[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ rule_id: "r1", success: false });
    expect(String(rows[0].error_message)).toMatch(/automation runs/);
    expect(told).toHaveLength(1);
    expect(told[0].map((n) => [n.userId, n.key])).toEqual([
      ["anna", "automationQuota"],
      ["luca", "automationQuota"],
    ]);
  });

  it("⚠️ once a day: the hundredth skipped record neither floods the log nor rings again", async () => {
    await runAutomations(event);
    await runAutomations({ ...event, entityId: "d2" });
    await runAutomations({ ...event, entityId: "d3" });

    expect((await db.execute(sql`select count(*)::int as n from automation_log`)).rows[0]).toEqual({ n: 1 });
    expect(told).toHaveLength(1);
  });

  it("says nothing when no rule would have run", async () => {
    await runAutomations({ ...event, event: "onCreate" });
    expect((await db.execute(sql`select count(*)::int as n from automation_log`)).rows[0]).toEqual({ n: 0 });
    expect(told).toEqual([]);
  });

  it("⚠️ only the rules asked for, and one notice a day even when another rule runs out later", async () => {
    await db.execute(sql`
      insert into automation_rule (id, name, target_entity, trigger_on, conditions, condition_logic, actions, is_active)
      values ('r2', 'Altra', 'deal', ARRAY['onUpdate']::text[], '[]', 'AND', '[]', true)`);

    await runAutomations({ ...event, ruleIds: ["r1"] });
    // The rule not named is not touched, even to say it was skipped.
    expect((await db.execute(sql`select rule_id from automation_log`)).rows).toEqual([{ rule_id: "r1" }]);
    await runAutomations({ ...event, ruleIds: ["r2"] });

    const rules = (await db.execute(sql`select rule_id from automation_log order by created_at`)).rows;
    expect(rules).toEqual([{ rule_id: "r1" }, { rule_id: "r2" }]);
    expect(told).toHaveLength(1);
  });
});
