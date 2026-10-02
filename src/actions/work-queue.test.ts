/**
 * The work queue's server side, against a real Postgres: who to call about each row, and a
 * contact logged with its outcome and next step.
 *
 * ⚠️⚠️ Working the list meant opening forty records one at a time to find the number to
 * dial, then typing the call into the timeline, then a task for the next step.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";
import { reachFor } from "@/lib/record-reach";

const db = drizzle(new PGlite());

vi.mock("@/lib/tenant-context", () => ({ getDb: async () => db }));
vi.mock("@/lib/workspace-time-zone", () => ({ getWorkspaceTimeZone: async () => "Europe/Rome" }));
vi.mock("@/lib/auth-guard", () => ({
  requireCapability: async () => ({ userId: "anna", tenantRole: "editor", isPlatformStaff: false }),
  requireWriteAccess: async () => ({ user: { id: "anna", role: "editor" } }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const { logContactAction } = await import("./activities");
const { getWorkQueue } = await import("./next-actions");

beforeAll(async () => {
  await applyTenantMigrations(db as never);
}, 120_000);

beforeEach(async () => {
  for (const t of ["next_action_snooze", "task", "activity", "quote", "deal", "lead", "contact", "company"]) {
    await db.execute(sql.raw(`delete from "${t}"`));
  }
  await db.execute(sql`delete from "user"`);
  await db.execute(sql`insert into "user" (id, name, email) values ('anna', 'Anna', 'a@x.it')`);
  await db.execute(
    sql`insert into company (id, name, main_phone, main_email) values ('co1', 'Rossi Srl', '010 111', 'info@rossi.it')`,
  );
  await db.execute(sql`
    insert into contact (id, first_name, last_name, phone, mobile, email, company_id)
    values ('ct1', 'Mario', 'Rossi', '010 222', '333 444', 'mario@rossi.it', 'co1')`);
});

describe("⚠️⚠️ who to call about each row", () => {
  it("a deal's contact, mobile first, logged on the deal", async () => {
    await db.execute(sql`insert into deal (id, name, contact_id, company_id) values ('d1', 'Rinnovo', 'ct1', 'co1')`);
    const reach = await reachFor(db as never, [{ entity: "deal", id: "d1" }]);
    expect(reach.get("deal:d1")).toEqual({
      name: "Mario Rossi",
      phone: "333 444",
      email: "mario@rossi.it",
      target: { entity: "deal", id: "d1" },
    });
  });

  it("a deal with no contact falls back to its company's switchboard", async () => {
    await db.execute(sql`insert into deal (id, name, company_id) values ('d1', 'Rinnovo', 'co1')`);
    const reach = await reachFor(db as never, [{ entity: "deal", id: "d1" }]);
    expect(reach.get("deal:d1")).toMatchObject({
      name: "Rossi Srl",
      phone: "010 111",
      target: { entity: "deal", id: "d1" },
    });
  });

  it("a lead, a company, and the person behind a reply task", async () => {
    await db.execute(sql`insert into lead (id, first_name, last_name, phone) values ('l1', 'Giulia', 'B', '555')`);
    await db.execute(sql`insert into task (id, title, contact_id) values ('t1', '↩ Mario: Re', 'ct1')`);
    const reach = await reachFor(db as never, [
      { entity: "lead", id: "l1" },
      { entity: "company", id: "co1" },
      { entity: "task", id: "t1" },
    ]);
    expect(reach.get("lead:l1")).toMatchObject({
      name: "Giulia B",
      phone: "555",
      target: { entity: "lead", id: "l1" },
    });
    expect(reach.get("company:co1")).toMatchObject({ phone: "010 111", target: { entity: "company", id: "co1" } });
    expect(reach.get("task:t1")).toMatchObject({ name: "Mario Rossi", target: { entity: "contact", id: "ct1" } });
  });

  it("the queue carries it on every row of the work list", async () => {
    await db.execute(sql`
      insert into deal (id, name, contact_id, owner_id, created_at)
      values ('d1', 'Rinnovo', 'ct1', 'anna', now() - interval '3 days')`);
    const [row] = await getWorkQueue();
    expect(row).toMatchObject({
      kind: "deal_no_next_step",
      reach: { phone: "333 444", target: { entity: "deal", id: "d1" } },
    });
  });
});

describe("⚠️⚠️ a contact logged from the queue", () => {
  it("becomes the record's activity, with its outcome, owned by whoever made it — and plans the next step", async () => {
    await db.execute(sql`insert into deal (id, name) values ('d1', 'Rinnovo')`);

    await logContactAction({
      target: { entity: "deal", id: "d1" },
      type: "call",
      outcome: "no_answer",
      note: "Richiamare nel pomeriggio",
      next: { type: "call", title: "Richiamare Rossi", dueDate: new Date("2026-10-02T00:00:00Z") },
    });

    const [a] = (await db.execute(sql`select type, outcome, content, owner_id, deal_id from activity`)).rows;
    expect(a).toEqual({
      type: "call",
      outcome: "no_answer",
      content: "Richiamare nel pomeriggio",
      owner_id: "anna",
      deal_id: "d1",
    });
    const [t] = (await db.execute(sql`select title, type, owner_id, assignee_id, deal_id from task`)).rows;
    expect(t).toEqual({
      title: "Richiamare Rossi",
      type: "call",
      owner_id: "anna",
      assignee_id: "anna",
      deal_id: "d1",
    });
  });

  it("drops an outcome that does not belong to the kind of contact", async () => {
    await db.execute(sql`insert into lead (id, first_name, last_name) values ('l1', 'Giulia', 'B')`);
    await logContactAction({ target: { entity: "lead", id: "l1" }, type: "email", outcome: "no_show" });
    const [a] = (await db.execute(sql`select type, outcome, lead_id from activity`)).rows;
    expect(a).toEqual({ type: "email", outcome: null, lead_id: "l1" });
  });

  it("refuses a record kind it does not know", async () => {
    await expect(logContactAction({ target: { entity: "ticket" as never, id: "x" }, type: "call" })).rejects.toThrow();
  });
});
