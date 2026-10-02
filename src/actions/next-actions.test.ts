/**
 * The work list, against a real Postgres: the rules added for a CRM that guides, and the
 * rows a person can put aside.
 *
 * ⚠️⚠️ An open deal with nothing planned, an answer a customer is waiting for, a quote
 * accepted and never turned into an order — none of them was on the list, and nothing on
 * it could be done from where it was.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";
import { leadScoreWeight, withoutSnoozed } from "@/lib/next-actions";

const db = drizzle(new PGlite());
let me = "anna";

vi.mock("@/lib/tenant-context", () => ({ getDb: async () => db }));
vi.mock("@/lib/workspace-time-zone", () => ({ getWorkspaceTimeZone: async () => "Europe/Rome" }));
vi.mock("@/lib/auth-guard", () => ({
  requireCapability: async () => ({ userId: me, tenantRole: "editor", isPlatformStaff: false }),
}));

const { getNextActions, snoozeNextActionAction } = await import("./next-actions");

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

beforeAll(async () => {
  await applyTenantMigrations(db as never);
}, 120_000);

beforeEach(async () => {
  me = "anna";
  for (const t of [
    "next_action_snooze",
    "task",
    "activity",
    "quote",
    "deal",
    "lead",
    "company",
    "ticket",
    "user_group_member",
    "user_group",
  ]) {
    await db.execute(sql.raw(`delete from "${t}"`));
  }
  await db.execute(sql`delete from "user"`);
  await db.execute(
    sql`insert into "user" (id, name, email) values ('anna', 'Anna', 'a@x.it'), ('luca', 'Luca', 'l@x.it')`,
  );
  await db.execute(sql`insert into company (id, name) values ('co1', 'Rossi Srl')`);
});

const kinds = async () => (await getNextActions(50)).map((a) => `${a.kind}:${a.id}`);

describe("⚠️⚠️ an open deal with nothing planned", () => {
  it("is on its owner's list, with somewhere to plan the step", async () => {
    await db.execute(
      sql`insert into deal (id, name, owner_id, created_at) values ('d1', 'Rinnovo', 'anna', ${ago(3)})`,
    );

    const [row] = await getNextActions(50);
    expect(row).toMatchObject({ kind: "deal_no_next_step", id: "d1", followUp: { entity: "deal", id: "d1" } });
  });

  it("is not, once a step is planned", async () => {
    await db.execute(
      sql`insert into deal (id, name, owner_id, created_at) values ('d1', 'Rinnovo', 'anna', ${ago(3)})`,
    );
    await db.execute(sql`insert into task (id, title, deal_id, status) values ('t1', 'Chiamare', 'd1', 'todo')`);

    expect(await kinds()).toEqual([]);
  });

  it("⚠️ appears once: a stalled deal says so, not also that nothing is planned", async () => {
    await db.execute(sql`insert into deal (id, name, owner_id, created_at) values ('d1', 'Ferma', 'anna', ${ago(30)})`);

    expect(await kinds()).toEqual(["deal_stalled:d1"]);
  });

  it("is nobody else's", async () => {
    await db.execute(
      sql`insert into deal (id, name, owner_id, created_at) values ('d1', 'Di Luca', 'luca', ${ago(3)})`,
    );
    expect(await kinds()).toEqual([]);
  });
});

describe("a reply owed", () => {
  it("is on the list of whoever has to answer, with the task to complete", async () => {
    await db.execute(sql`insert into contact (id, first_name, last_name) values ('c1', 'Mario', 'Rossi')`);
    await db.execute(sql`
      insert into task (id, title, type, status, assignee_id, contact_id, created_at)
      values ('r1', '↩ Mario Rossi: Re: Preventivo', 'email', 'todo', 'anna', 'c1', ${ago(2)})`);

    const [row] = await getNextActions(50);
    expect(row).toMatchObject({
      kind: "reply_due",
      taskId: "r1",
      title: "Mario Rossi: Re: Preventivo",
      href: "/dashboard/contacts/c1",
      detailValue: 2,
    });
  });

  it("is not an ordinary email task", async () => {
    await db.execute(sql`
      insert into task (id, title, type, status, assignee_id) values ('t1', 'Scrivere a Rossi', 'email', 'todo', 'anna')`);
    expect(await kinds()).toEqual([]);
  });
});

describe("an accepted quote", () => {
  it("asks to be turned into an order, and plans on its deal", async () => {
    await db.execute(sql`insert into deal (id, name, owner_id, company_id) values ('d1', 'Rinnovo', 'luca', 'co1')`);
    await db.execute(sql`
      insert into quote (id, quote_number, deal_id, company_id, owner_id, status, accepted_at, subtotal, total_amount)
      values ('q1', 'Q-1', 'd1', 'co1', 'anna', 'accepted', ${ago(4)}, '100', '122')`);

    const [row] = await getNextActions(50);
    expect(row).toMatchObject({
      kind: "quote_to_order",
      id: "q1",
      followUp: { entity: "deal", id: "d1" },
      detailValue: 4,
    });
  });
});

describe("⚠️ putting a row aside", () => {
  it("hides it from this person only, until the day chosen", async () => {
    await db.execute(
      sql`insert into deal (id, name, owner_id, created_at) values ('d1', 'Rinnovo', 'anna', ${ago(3)})`,
    );

    await snoozeNextActionAction("deal_no_next_step", "d1", 3);
    expect(await kinds()).toEqual([]);

    await db.execute(sql`update next_action_snooze set until = ${ago(1)}`);
    expect(await kinds()).toEqual(["deal_no_next_step:d1"]);
  });

  it("refuses a snooze of any other length", async () => {
    await expect(snoozeNextActionAction("deal_no_next_step", "d1", 30)).rejects.toThrow();
  });

  it("is a pure filter too", () => {
    const row = { kind: "deal_stalled", id: "x" } as never;
    expect(withoutSnoozed([row], [{ kind: "deal_stalled", entityId: "x", until: new Date(Date.now() + DAY) }])).toEqual(
      [],
    );
    expect(withoutSnoozed([row], [{ kind: "deal_stalled", entityId: "x", until: new Date(Date.now() - DAY) }])).toEqual(
      [row],
    );
  });
});

describe("a lead's score", () => {
  it("puts a hot lead above a cold one left alone as long", async () => {
    await db.execute(sql`
      insert into lead (id, first_name, last_name, owner_id, created_at, lead_score)
      values ('cold', 'A', 'A', 'anna', ${ago(5)}, 0), ('hot', 'B', 'B', 'anna', ${ago(5)}, 90)`);

    expect(await kinds()).toEqual(["lead_untouched:hot", "lead_untouched:cold"]);
    expect(leadScoreWeight(null)).toBe(0);
    expect(leadScoreWeight(500)).toBe(2);
  });
});

describe("⚠️⚠️ a call planned for today (S2)", () => {
  it("is on the list of whoever has to make it, completed as a call", async () => {
    await db.execute(sql`
      insert into task (id, title, type, status, assignee_id, owner_id, due_date)
      values ('t1', 'Richiamare Rossi', 'call', 'todo', 'anna', 'luca', ${new Date()})`);

    const [row] = await getNextActions(50);
    expect(row).toMatchObject({ kind: "call_due", id: "t1", taskId: "t1", taskType: "call", detailKey: "callToday" });
    me = "luca";
    expect(await kinds()).toEqual([]);
  });

  it("is its owner's when nobody is assigned", async () => {
    await db.execute(sql`
      insert into task (id, title, type, status, owner_id, due_date)
      values ('t1', 'Richiamare', 'call', 'todo', 'anna', ${new Date()})`);
    expect(await kinds()).toEqual(["call_due:t1"]);
  });

  it("says how late it is, and outranks one due today", async () => {
    await db.execute(sql`
      insert into task (id, title, type, status, assignee_id, due_date)
      values ('today', 'Oggi', 'call', 'todo', 'anna', ${new Date()}),
             ('late', 'Ieri', 'call', 'todo', 'anna', ${ago(2)})`);
    const rows = await getNextActions(50);
    expect(rows.map((r) => r.id)).toEqual(["late", "today"]);
    expect(rows[0]).toMatchObject({ detailKey: "callLate" });
    expect(rows[0].detailValue).toBeGreaterThanOrEqual(2);
  });

  it("is not there when done, planned for later, or not a call", async () => {
    await db.execute(sql`
      insert into task (id, title, type, status, assignee_id, due_date)
      values ('done', 'Fatta', 'call', 'done', 'anna', ${new Date()}),
             ('later', 'Dopo', 'call', 'todo', 'anna', ${new Date(Date.now() + 3 * DAY)}),
             ('todo', 'Preparare', 'todo', 'todo', 'anna', ${new Date()})`);
    expect(await kinds()).toEqual([]);
  });
});

describe("⚠️⚠️ a lead that has just arrived (S2)", () => {
  it("is on the list at once, before it has gone cold", async () => {
    await db.execute(sql`
      insert into lead (id, first_name, last_name, owner_id, status, created_at)
      values ('l1', 'Mario', 'Rossi', 'anna', 'new', ${new Date()})`);
    const [row] = await getNextActions(50);
    expect(row).toMatchObject({
      kind: "lead_new",
      id: "l1",
      detailKey: "arrivedJustNow",
      followUp: { entity: "lead" },
    });
  });

  it("is everybody's while nobody owns it, and its group's while a group does", async () => {
    await db.execute(sql`insert into user_group (id, name) values ('cc', 'Call center')`);
    await db.execute(sql`insert into user_group_member (group_id, user_id) values ('cc', 'luca')`);
    await db.execute(sql`
      insert into lead (id, first_name, last_name, status, owner_id, group_id, created_at)
      values ('pool', 'A', 'A', 'new', null, null, ${new Date()}),
             ('group', 'B', 'B', 'new', null, 'cc', ${new Date()}),
             ('theirs', 'C', 'C', 'new', 'luca', null, ${new Date()})`);

    expect((await kinds()).sort()).toEqual(["lead_new:pool"]);
    me = "luca";
    expect((await kinds()).sort()).toEqual(["lead_new:group", "lead_new:pool", "lead_new:theirs"]);
  });

  it("leaves once somebody has spoken to it, but not for a note", async () => {
    await db.execute(sql`
      insert into lead (id, first_name, last_name, status, owner_id, created_at)
      values ('called', 'A', 'A', 'new', 'anna', ${new Date()}), ('noted', 'B', 'B', 'new', 'anna', ${new Date()})`);
    await db.execute(sql`
      insert into activity (id, type, content, lead_id) values ('a1', 'call', 'Chiamata', 'called'), ('a2', 'note', 'Nota', 'noted')`);
    expect(await kinds()).toEqual(["lead_new:noted"]);
  });

  it("⚠️ is one row: a call planned on it stands for it", async () => {
    await db.execute(sql`
      insert into lead (id, first_name, last_name, status, owner_id, created_at) values ('l1', 'A', 'A', 'new', 'anna', ${new Date()})`);
    await db.execute(sql`
      insert into task (id, title, type, status, assignee_id, lead_id, due_date)
      values ('t1', 'Richiamare', 'call', 'todo', 'anna', 'l1', ${new Date()})`);
    expect(await kinds()).toEqual(["call_due:t1"]);
  });

  it("is a cold lead past the threshold, and only its owner's", async () => {
    await db.execute(sql`
      insert into lead (id, first_name, last_name, status, owner_id, created_at)
      values ('old', 'A', 'A', 'new', 'anna', ${ago(5)}), ('oldpool', 'B', 'B', 'new', null, ${ago(5)})`);
    expect(await kinds()).toEqual(["lead_untouched:old"]);
  });
});
