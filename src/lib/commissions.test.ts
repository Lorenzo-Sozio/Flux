/**
 * Commissions (src/lib/commissions.ts) on a real Postgres: which rate pays a win, which month
 * it counts in, and what approving a month freezes.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";
import * as schema from "@/db/schema";

import {
  approveCommissionMonth,
  type CommissionRule,
  commissionOn,
  commissionReport,
  readRule,
  reopenCommissionMonth,
  ruleFor,
  saveCommissionRule,
} from "./commissions";

const db = drizzle(new PGlite(), { schema });
const TZ = "Europe/Rome";
const OCT = new Date("2026-10-05T10:00:00Z");

const rule = (r: Partial<CommissionRule> & { ratePercent: number; validFrom: string }): CommissionRule => ({
  id: `${r.userId ?? "*"}/${r.pipelineId ?? "*"}/${r.validFrom}`,
  userId: null,
  pipelineId: null,
  ...r,
});

async function won(id: string, owner: string | null, amount: number, closedAt: string, stage = "s1") {
  await db.execute(sql`insert into deal (id, name, amount, owner_id, stage_id, status, closed_at)
    values (${id}, ${`Deal ${id}`}, ${String(amount)}, ${owner}, ${stage}, 'won', ${closedAt})`);
}
const report = (period: string, owners?: string[]) => commissionReport(db, { period, timeZone: TZ, owners });
const approve = (month: string, now = OCT) =>
  approveCommissionMonth(db, { month, timeZone: TZ, approverId: "boss", now });

beforeAll(async () => {
  await applyTenantMigrations(db as never);
}, 120_000);

beforeEach(async () => {
  for (const t of ["commission_line", "commission_statement", "commission_rule", "deal", "pipeline_stage", "user"])
    await db.execute(sql.raw(`delete from "${t}"`));
  await db.execute(sql`delete from pipeline where id <> 'default'`);
  await db.execute(sql`insert into pipeline (id, name) values ('renew', 'Rinnovi')`);
  await db.execute(sql`insert into pipeline_stage (id, name, "order", pipeline_id) values
    ('s1', 'Nuovi', 1, 'default'), ('r1', 'Rinnovi', 1, 'renew')`);
  await db.execute(
    sql`insert into "user" (id, name, email) values ('anna', 'Anna', 'a@x.it'), ('luca', 'Luca', 'l@x.it'), ('boss', 'Capo', 'c@x.it')`,
  );
});

describe("⚠️⚠️ which rate pays a win", () => {
  const rules = [
    rule({ ratePercent: 3, validFrom: "2026-01-01" }),
    rule({ pipelineId: "renew", ratePercent: 2, validFrom: "2026-01-01" }),
    rule({ userId: "anna", ratePercent: 5, validFrom: "2026-01-01" }),
    rule({ userId: "anna", ratePercent: 6, validFrom: "2026-09-15" }),
    rule({ userId: "anna", pipelineId: "renew", ratePercent: 4, validFrom: "2026-01-01" }),
  ];
  const pick = (userId: string | null, pipelineId: string, day: string) =>
    ruleFor(rules, { userId, pipelineId, day })?.ratePercent ?? null;

  it("the most specific: person and pipeline, person, pipeline, everyone", () => {
    expect(pick("anna", "renew", "2026-09-01")).toBe(4);
    expect(pick("anna", "default", "2026-09-01")).toBe(5);
    expect(pick("luca", "renew", "2026-09-01")).toBe(2);
    expect(pick("luca", "default", "2026-09-01")).toBe(3);
  });

  it("⚠️ a person's rate beats a pipeline's, even a newer one", () => {
    const personVsPipeline = [
      rule({ userId: "anna", ratePercent: 5, validFrom: "2026-01-01" }),
      rule({ pipelineId: "renew", ratePercent: 2, validFrom: "2026-06-01" }),
    ];
    expect(ruleFor(personVsPipeline, { userId: "anna", pipelineId: "renew", day: "2026-09-01" })?.ratePercent).toBe(5);
  });

  it("⚠️ in the same scope, the latest that had started on the day of the win", () => {
    expect(pick("anna", "default", "2026-09-14")).toBe(5);
    expect(pick("anna", "default", "2026-09-15")).toBe(6);
    // Specific beats recent: a new rate for everyone does not override Anna's.
    expect(
      ruleFor([...rules, rule({ ratePercent: 9, validFrom: "2026-09-20" })], {
        userId: "anna",
        pipelineId: "default",
        day: "2026-09-21",
      })?.ratePercent,
    ).toBe(6);
  });

  it("nothing before the first rule, and nothing for a deal nobody owned", () => {
    expect(pick("luca", "default", "2025-12-31")).toBeNull();
    expect(pick(null, "default", "2026-09-01")).toBeNull();
  });

  it("to the cent, and nothing on nothing", () => {
    expect(commissionOn(1234.56, 3.33)).toBe(41.11);
    expect(commissionOn(1000, 7.5)).toBe(75);
    // Half a cent, in whole cents: 1.15 × 50% is 0.575, and binary made it 0.57.
    expect(commissionOn(1.15, 50)).toBe(0.58);
    expect(commissionOn(0, 5)).toBe(0);
    expect(commissionOn(-500, 5)).toBe(0);
  });

  it("a rule as typed", () => {
    expect(readRule({ ratePercent: "7,5", validFrom: "2026-09-01" })).toEqual({
      userId: null,
      pipelineId: null,
      ratePercent: 7.5,
      validFrom: "2026-09-01",
    });
    expect(readRule({ ratePercent: 101, validFrom: "2026-09-01" })).toBeNull();
    expect(readRule({ ratePercent: -1, validFrom: "2026-09-01" })).toBeNull();
    expect(readRule({ ratePercent: "abc", validFrom: "2026-09-01" })).toBeNull();
    expect(readRule({ ratePercent: 5, validFrom: "2026-02-31" })).toBeNull();
    expect(readRule({ ratePercent: 5, validFrom: "01/09/2026" })).toBeNull();
  });
});

describe("the report", () => {
  beforeEach(async () => {
    await saveCommissionRule(db, { userId: null, pipelineId: null, ratePercent: 5, validFrom: "2026-01-01" }, "boss");
  });

  it("⚠️⚠️ a win counts in the month of the workspace's clock, not the server's", async () => {
    // 00:30 on 1 September in Rome is still 31 August in UTC.
    await won("d1", "anna", 1000, "2026-08-31T22:30:00Z");
    expect((await report("2026-08"))?.lines).toHaveLength(0);
    const sept = await report("2026-09");
    expect(sept?.lines.map((l) => [l.dealId, l.month, l.amount])).toEqual([["d1", "2026-09", 50]]);
  });

  it("⚠️ a rate changed later keeps the rate each deal was won at", async () => {
    await saveCommissionRule(db, { userId: null, pipelineId: null, ratePercent: 8, validFrom: "2026-09-15" }, "boss");
    await won("early", "anna", 1000, "2026-09-10T10:00:00Z");
    await won("late", "anna", 1000, "2026-09-20T10:00:00Z");
    const r = await report("2026-09");
    expect(r?.lines.map((l) => [l.dealId, l.ratePercent, l.amount])).toEqual([
      ["early", 5, 50],
      ["late", 8, 80],
    ]);
    expect(r?.rows).toEqual([expect.objectContaining({ userId: "anna", deals: 2, base: 2000, amount: 130 })]);
  });

  it("a win nobody owned is listed and paid to nobody", async () => {
    await won("orphan", null, 1000, "2026-09-10T10:00:00Z");
    const r = await report("2026-09");
    expect(r?.lines[0]).toMatchObject({ dealId: "orphan", ratePercent: null, amount: 0 });
    expect(r?.totals.unpaid).toBe(1);
  });

  it("narrows to the people asked for", async () => {
    await won("a", "anna", 1000, "2026-09-10T10:00:00Z");
    await won("b", "luca", 1000, "2026-09-11T10:00:00Z");
    expect((await report("2026-09", ["luca"]))?.lines.map((l) => l.dealId)).toEqual(["b"]);
  });

  it("⚠️ an open or lost deal earns nothing", async () => {
    await db.execute(sql`insert into deal (id, name, amount, owner_id, stage_id, status, closed_at) values
      ('o', 'Open', '1000', 'anna', 's1', 'open', null),
      ('l', 'Lost', '1000', 'anna', 's1', 'lost', '2026-09-10T10:00:00Z')`);
    expect((await report("2026-09"))?.lines).toHaveLength(0);
  });
});

describe("⚠️⚠️ approving a month", () => {
  beforeEach(async () => {
    await saveCommissionRule(db, { userId: null, pipelineId: null, ratePercent: 5, validFrom: "2026-01-01" }, "boss");
    await won("d1", "anna", 1000, "2026-08-10T10:00:00Z");
    await won("d2", "luca", 2000, "2026-08-20T10:00:00Z");
  });

  it("⚠️ a month typed with a space is stored as the reports read it", async () => {
    expect(await approve(" 2026-08")).toMatchObject({ ok: true, lines: 2 });
    expect((await report("2026-08"))?.months[0].approvedAt).not.toBeNull();
    expect(await reopenCommissionMonth(db, " 2026-08 ")).toBe(true);
  });

  it("only once it is over", async () => {
    expect(await approve("2026-10")).toEqual({ ok: false, reason: "not_over" });
    expect(await approve("2026-Q3")).toEqual({ ok: false, reason: "invalid" });
  });

  it("freezes each line: later edits to the deal do not move what was paid, and say so", async () => {
    expect(await approve("2026-08")).toMatchObject({ ok: true, lines: 2, total: 150 });
    // The rate goes up, one deal grows, one is reopened.
    await saveCommissionRule(db, { userId: null, pipelineId: null, ratePercent: 10, validFrom: "2026-01-01" }, "boss");
    await db.execute(sql`update deal set amount = '5000' where id = 'd1'`);
    await db.execute(sql`update deal set status = 'open', closed_at = null where id = 'd2'`);
    const r = await report("2026-08");
    expect(r?.lines.map((l) => [l.dealId, l.approved, l.amount, l.drift])).toEqual([
      ["d1", true, 50, "amount"],
      ["d2", true, 100, "reopened"],
    ]);
    expect(r?.months[0]).toMatchObject({ month: "2026-08", approvedBy: "boss" });
    expect(r?.totals.approved).toBe(150);
  });

  it("⚠️ a deal handed to somebody else after it was paid stays paid to whoever won it", async () => {
    await approve("2026-08");
    await db.execute(sql`update deal set owner_id = 'luca' where id = 'd1'`);
    expect((await report("2026-08"))?.lines.find((l) => l.dealId === "d1")).toMatchObject({
      userId: "anna",
      drift: "owner",
    });
  });

  it("⚠️ a deleted deal stays on the month it was paid in, by name", async () => {
    await approve("2026-08");
    await db.execute(sql`delete from deal where id = 'd1'`);
    const line = (await report("2026-08"))?.lines.find((l) => l.dealName === "Deal d1");
    expect(line).toMatchObject({ dealId: null, amount: 50, drift: "deleted" });
  });

  it("⚠️⚠️ twice at once approves once", async () => {
    const results = await Promise.all([approve("2026-08"), approve("2026-08")]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, reason: "already" }]);
    const lines = await db.execute(sql`select count(*)::int as n from commission_line`);
    expect(lines.rows[0]).toEqual({ n: 2 });
  });

  it("⚠️⚠️ a deal is paid once, even if it is won again later", async () => {
    await approve("2026-08");
    await db.execute(sql`update deal set closed_at = '2026-09-05T10:00:00Z' where id = 'd1'`);
    expect((await report("2026-09"))?.lines).toHaveLength(0);
    expect(await approve("2026-09")).toMatchObject({ ok: true, lines: 0 });
  });

  it("⚠️ a win dated into an approved month is paid with the next month approved", async () => {
    await approve("2026-08");
    await won("back", "anna", 400, "2026-08-25T10:00:00Z");
    expect((await report("2026-08"))?.lines.find((l) => l.dealId === "back")).toMatchObject({
      approved: false,
      late: true,
    });
    expect(await approve("2026-09")).toMatchObject({ ok: true, lines: 1, total: 20 });
    expect((await report("2026-08"))?.lines.some((l) => l.dealId === "back")).toBe(false);
  });

  it("⚠️ does not sweep in the wins of months never approved", async () => {
    // June approved, July skipped: approving August reads back to June for late wins,
    // and must still leave July's alone.
    expect(await approve("2026-06")).toMatchObject({ ok: true, lines: 0 });
    await won("july", "anna", 1000, "2026-07-10T10:00:00Z");
    expect(await approve("2026-08")).toMatchObject({ ok: true, lines: 2 });
    expect((await report("2026-07"))?.lines.map((l) => [l.dealId, l.approved])).toEqual([["july", false]]);
  });

  it("reopening a month computes it again from today", async () => {
    await approve("2026-08");
    await db.execute(sql`update deal set amount = '5000' where id = 'd1'`);
    expect(await reopenCommissionMonth(db, "2026-08")).toBe(true);
    const r = await report("2026-08");
    expect(r?.lines.map((l) => [l.dealId, l.approved, l.amount])).toEqual([
      ["d1", false, 250],
      ["d2", false, 100],
    ]);
    expect(r?.months[0].approvedAt).toBeNull();
  });
});

describe("rules", () => {
  it("one per scope and day: saving the same again changes its rate", async () => {
    const r = { userId: "anna", pipelineId: null, validFrom: "2026-09-01" };
    await saveCommissionRule(db, { ...r, ratePercent: 5 }, "boss");
    await saveCommissionRule(db, { ...r, ratePercent: 7 }, "boss");
    await saveCommissionRule(db, { ...r, userId: null, ratePercent: 3 }, "boss");
    const rows = await db.execute(sql`select user_id, rate_percent from commission_rule order by rate_percent`);
    expect(rows.rows).toEqual([
      { user_id: null, rate_percent: "3.00" },
      { user_id: "anna", rate_percent: "7.00" },
    ]);
  });
});
