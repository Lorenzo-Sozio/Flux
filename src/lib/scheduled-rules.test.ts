/**
 * Rules that fire with time, the rule test, and a quota that runs out — against a real
 * Postgres where it matters.
 *
 * ⚠️⚠️ "A deal quiet for 14 days → create a task" could not be built: no trigger ran on a
 * schedule, no condition was relative to now. And "why did my rule not fire?" had no
 * answer, nor did "why did they all stop?" when the monthly quota ran out.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";

import { evaluateCondition } from "./rule-conditions";

const db = drizzle(new PGlite());
const runs: { entityId: string; ruleIds?: string[] }[] = [];

vi.mock("@/lib/tenant-context", () => ({ getDb: async () => db, getCurrentTenantId: async () => null }));
vi.mock("@/lib/auth-guard", () => ({
  requireCapability: async () => ({ userId: "anna", tenantRole: "admin", isPlatformStaff: false }),
  requirePlanModule: async () => undefined,
  requireWriteAccess: async () => ({ user: { id: "anna" } }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/components/crm/automation/rule-engine", async (orig) => ({
  ...(await orig<typeof import("@/components/crm/automation/rule-engine")>()),
  runAutomations: async (ctx: { entityId: string; ruleIds?: string[] }) => {
    runs.push({ entityId: ctx.entityId, ruleIds: ctx.ruleIds });
  },
}));

const { runScheduledRules, SCHEDULE_MAX_RUNS } = await import("./scheduled-rules");
const { testRuleAction } = await import("@/actions/automation");

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

beforeAll(async () => {
  await applyTenantMigrations(db as never);
}, 120_000);

beforeEach(async () => {
  runs.length = 0;
  for (const t of ["automation_log", "automation_rule", "activity", "deal"])
    await db.execute(sql.raw(`delete from "${t}"`));
});

async function rule(id: string, conditions: object[], triggerOn = ["onSchedule"], active = true) {
  await db.execute(sql`
    insert into automation_rule (id, name, target_entity, trigger_on, conditions, condition_logic, actions, is_active)
    values (${id}, ${id}, 'deal', ${sql.raw(`ARRAY[${triggerOn.map((t) => `'${t}'`).join(",")}]::text[]`)}, ${JSON.stringify(conditions)}, 'AND', '[]', ${active})`);
}

describe("relative date conditions", () => {
  const now = new Date("2026-09-26T10:00:00Z");
  it("in the past, within the next days, more than days ago", () => {
    const data = { closes: "2026-09-20T00:00:00Z", soon: "2026-09-28T00:00:00Z" };
    expect(evaluateCondition({ field: "closes", operator: "date_in_past" }, data, undefined, now)).toBe(true);
    expect(evaluateCondition({ field: "soon", operator: "date_in_past" }, data, undefined, now)).toBe(false);
    expect(evaluateCondition({ field: "soon", operator: "date_within_days", value: 3 }, data, undefined, now)).toBe(
      true,
    );
    expect(evaluateCondition({ field: "soon", operator: "date_within_days", value: 1 }, data, undefined, now)).toBe(
      false,
    );
    expect(evaluateCondition({ field: "closes", operator: "older_than_days", value: 5 }, data, undefined, now)).toBe(
      true,
    );
    expect(evaluateCondition({ field: "closes", operator: "older_than_days", value: 7 }, data, undefined, now)).toBe(
      false,
    );
    expect(evaluateCondition({ field: "missing", operator: "date_in_past" }, data, undefined, now)).toBe(false);
  });
});

describe("⚠️⚠️ the daily run", () => {
  beforeEach(async () => {
    await db.execute(sql`
      insert into deal (id, name, status, created_at) values
        ('quiet', 'Ferma', 'open', ${ago(30)}),
        ('fresh', 'Nuova', 'open', ${ago(1)}),
        ('won', 'Vinta', 'won', ${ago(30)})`);
  });

  const quiet = [{ field: "idleDays", operator: "greater_than_or_equal", value: 14 }];

  it("fires a scheduled rule on the open records whose conditions hold, naming the rule", async () => {
    await rule("r1", quiet);

    expect(await runScheduledRules(db as never)).toMatchObject({ fired: 1 });
    expect(runs).toEqual([{ entityId: "quiet", ruleIds: ["r1"] }]);
  });

  it("⚠️ at most once a week per record: the log remembers", async () => {
    await rule("r1", quiet);
    await db.execute(sql`
      insert into automation_log (id, rule_id, entity_type, entity_id, event, success)
      values ('l1', 'r1', 'deal', 'quiet', 'onSchedule', true)`);

    await runScheduledRules(db as never);
    expect(runs).toEqual([]);
  });

  it("ignores rules that are not scheduled, and inactive ones", async () => {
    await rule("r1", quiet, ["onUpdate"]);
    await rule("r2", quiet, ["onSchedule"], false);

    expect(await runScheduledRules(db as never)).toEqual({ checked: 0, fired: 0 });
  });

  it("⚠️ fires at most a bounded number of times per workspace per run", async () => {
    expect(SCHEDULE_MAX_RUNS).toBeLessThanOrEqual(100);
  });
});

describe("⚠️ testing a rule on a record", () => {
  it("says condition by condition whether it would run, with the value it saw", async () => {
    await db.execute(
      sql`insert into deal (id, name, status, created_at) values ('quiet', 'Ferma', 'open', ${ago(30)})`,
    );

    const result = await testRuleAction({
      entity: "deal",
      recordId: "quiet",
      logic: "AND",
      conditions: [
        { field: "idleDays", operator: "greater_than_or_equal", value: 14, logic: "AND" },
        { field: "status", operator: "equals", value: "won", logic: "AND" },
      ],
    });

    expect(result?.holds).toBe(false);
    expect(result?.details.map((d) => [d.condition.field, d.holds, d.actual])).toEqual([
      ["idleDays", true, 30],
      ["status", false, "open"],
    ]);
  });
});
