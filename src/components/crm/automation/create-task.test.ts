/**
 * The automation action that plans a task, against a real Postgres.
 *
 * ⚠️⚠️ `task.assignee_id` is a foreign key to a user. The builder stored "" for
 * "unassigned" and every recipe stored the "entity_owner" sentinel, and the action wrote
 * either straight into the column: the key refused it, and every rule that planned a task
 * failed on every run, logged as an error nobody reads.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";

const db = drizzle(new PGlite());

vi.mock("@/lib/tenant-context", () => ({ getDb: async () => db, getCurrentTenantId: async () => "t1" }));
vi.mock("@/db", () => ({ platformDb: {} }));
vi.mock("@/lib/webhook-dispatch", () => ({
  dispatchWebhook: async () => undefined,
  dispatchRuleEvent: async () => undefined,
}));
vi.mock("@/lib/sequence-runner", () => ({ enroll: async () => ({ ok: true }) }));
vi.mock("@/lib/notify", () => ({ notify: async () => undefined }));
vi.mock("../../crm/automation/email-service", () => ({ sendAutomationEmailWithContext: async () => ({ retries: 0 }) }));
vi.mock("../../crm/automation/webhook-service", () => ({ sendWebhook: async () => ({ statusCode: 200, retries: 0 }) }));
vi.mock("../../crm/automation/rule-engine", () => ({ runAutomations: async () => undefined }));

const modulo = await import("@/components/crm/automation/action-dispatcher");
// biome-ignore lint/suspicious/noExplicitAny: the dispatcher's own export shape
const Dispatcher: any = Object.values(modulo).find((v) => typeof v === "function");

const CONTEXT = {
  entityType: "deal" as const,
  entityId: "d1",
  event: "onUpdate" as const,
  oldData: { status: "open" },
  newData: { status: "won" },
};

const createTask = (assigneeId?: string) => ({
  type: "create_task" as const,
  params: { title: "Passa all'amministrazione", priority: "normal", dueDateDays: 1, assigneeId },
});

const assignee = async () =>
  (await db.execute(sql`select assignee_id from task where deal_id = 'd1'`)).rows.map(
    (r) => (r as { assignee_id: string | null }).assignee_id,
  );

beforeAll(async () => {
  await applyTenantMigrations(db as never);
  await db.execute(sql`insert into "user" (id, email) values ('anna', 'a@x.it'), ('luca', 'l@x.it')`);
  await db.execute(sql`insert into pipeline_stage (id, name, "order") values ('s1', 'Nuova', 1)`);
}, 120_000);

beforeEach(async () => {
  await db.execute(sql`delete from task`);
  await db.execute(sql`delete from deal`);
  await db.execute(sql`insert into deal (id, name, stage_id, owner_id) values ('d1', 'Impianto', 's1', 'anna')`);
});

describe("⚠️⚠️ a rule that plans a task", () => {
  it("gives it to the record's owner when the rule says so", async () => {
    await new Dispatcher().dispatch(createTask("entity_owner"), CONTEXT, {});
    expect(await assignee()).toEqual(["anna"]);
  });

  it("leaves it unassigned when the rule says nobody, instead of failing", async () => {
    await new Dispatcher().dispatch(createTask(""), CONTEXT, {});
    await new Dispatcher().dispatch(createTask(undefined), CONTEXT, {});
    expect(await assignee()).toEqual([null, null]);
  });

  it("gives it to the person the rule names", async () => {
    await new Dispatcher().dispatch(createTask("luca"), CONTEXT, {});
    expect(await assignee()).toEqual(["luca"]);
  });
});
