/**
 * A record's timeline and its field history, against a real Postgres.
 *
 * ⚠️⚠️ The timeline showed only activities carrying the record's own key — a company never
 * saw the call logged on its deal — ordered by when a row was typed, never paged. And a
 * deal's amount halved or its owner changed left no trace anybody could read.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";

import { diffFields, historyValue, recordFieldChanges } from "./field-history";
import { loadRecordTimeline, recordTimelineSummary, type TimelineItem } from "./record-timeline";

const db = drizzle(new PGlite());
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

beforeAll(async () => {
  await applyTenantMigrations(db as never);
}, 120_000);

beforeEach(async () => {
  for (const t of [
    "field_change",
    "quote_activity",
    "quote",
    "activity",
    "deal",
    "contact",
    "company",
    "pipeline_stage",
  ]) {
    await db.execute(sql.raw(`delete from "${t}"`));
  }
  await db.execute(sql`delete from "user"`);
  await db.execute(
    sql`insert into "user" (id, name, email) values ('anna', 'Anna', 'a@x.it'), ('luca', 'Luca', 'l@x.it')`,
  );
  await db.execute(sql`insert into company (id, name) values ('co1', 'Rossi Srl'), ('co2', 'Altra')`);
  await db.execute(
    sql`insert into contact (id, first_name, last_name, company_id) values ('ct1', 'Mario', 'Rossi', 'co1'), ('ct2', 'Estraneo', 'X', 'co2')`,
  );
  await db.execute(
    sql`insert into deal (id, name, company_id, contact_id) values ('d1', 'Rinnovo', 'co1', 'ct1'), ('d2', 'Altro', 'co2', null)`,
  );
});

async function activity(
  id: string,
  links: { company?: string; contact?: string; deal?: string },
  when: Date,
  type = "call",
) {
  await db.execute(sql`
    insert into activity (id, type, content, date, company_id, contact_id, deal_id, owner_id)
    values (${id}, ${type}, ${id}, ${when}, ${links.company ?? null}, ${links.contact ?? null}, ${links.deal ?? null}, 'anna')`);
}

const keys = (items: TimelineItem[]) => items.map((i) => i.key);

describe("⚠️⚠️ what a record's timeline shows", () => {
  beforeEach(async () => {
    await activity("on-company", { company: "co1" }, ago(5));
    await activity("on-contact", { contact: "ct1" }, ago(4));
    await activity("on-deal", { deal: "d1" }, ago(3));
    await activity("elsewhere", { company: "co2", contact: "ct2", deal: "d2" }, ago(1));
  });

  it("a company sees its own, its contacts' and its deals', newest first — nobody else's", async () => {
    const { items } = await loadRecordTimeline(db as never, { type: "company", id: "co1" });
    expect(keys(items)).toEqual(["a:on-deal", "a:on-contact", "a:on-company"]);
    const onDeal = items[0];
    expect(onDeal.via).toEqual({ type: "deal", id: "d1", name: "Rinnovo" });
  });

  it("a contact sees its own and its deals'", async () => {
    const { items } = await loadRecordTimeline(db as never, { type: "contact", id: "ct1" });
    expect(keys(items)).toEqual(["a:on-deal", "a:on-contact"]);
    expect(items[1].via).toBeNull();
  });

  it("a deal sees only its own", async () => {
    const { items } = await loadRecordTimeline(db as never, { type: "deal", id: "d1" });
    expect(keys(items)).toEqual(["a:on-deal"]);
  });

  it("⚠️ orders by when it happened, not by when it was typed", async () => {
    // Typed today, about a call last month.
    await activity("backdated", { company: "co1" }, ago(30));
    const { items } = await loadRecordTimeline(db as never, { type: "company", id: "co1" });
    expect(keys(items).at(-1)).toBe("a:backdated");
  });
});

describe("⚠️⚠️ field history", () => {
  it("records only the tracked fields that changed, amounts compared as numbers", () => {
    expect(
      diffFields(
        "deal",
        {
          name: "A",
          amount: "1000.00",
          notes: "x",
          ownerId: "anna",
          expectedCloseDate: new Date("2026-10-01T00:00:00Z"),
        },
        { name: "A", amount: 1000, notes: "y", ownerId: "luca", expectedCloseDate: new Date("2026-11-01T00:00:00Z") },
      ),
    ).toEqual([
      { field: "expectedCloseDate", oldValue: "2026-10-01T00:00:00.000Z", newValue: "2026-11-01T00:00:00.000Z" },
      { field: "ownerId", oldValue: "anna", newValue: "luca" },
    ]);
    expect(historyValue("phone", "0101")).toBe("0101");
    expect(historyValue("name", "")).toBeNull();
  });

  it("is shown on the record, and on the company the deal belongs to, with names for ids", async () => {
    await db.execute(
      sql`insert into pipeline_stage (id, name, "order") values ('s1', 'Proposta', 1), ('s2', 'Trattativa', 2)`,
    );
    await recordFieldChanges(
      db as never,
      "deal",
      "d1",
      { stageId: "s1", ownerId: "anna" },
      { stageId: "s2", ownerId: "luca" },
      "luca",
    );

    const onDeal = (await loadRecordTimeline(db as never, { type: "deal", id: "d1" })).items;
    expect(onDeal).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "change",
          field: "stageId",
          oldLabel: "Proposta",
          newLabel: "Trattativa",
          byName: "Luca",
          via: null,
        }),
        expect.objectContaining({ kind: "change", field: "ownerId", oldLabel: "Anna", newLabel: "Luca" }),
      ]),
    );
    const onCompany = (await loadRecordTimeline(db as never, { type: "company", id: "co1" })).items;
    expect(onCompany[0]).toMatchObject({ kind: "change", via: { type: "deal", id: "d1" } });
  });

  it("writes nothing when nothing tracked changed", async () => {
    await recordFieldChanges(db as never, "contact", "ct1", { firstName: "Mario" }, { firstName: "Mario" }, "anna");
    expect((await db.execute(sql`select count(*)::int as n from field_change`)).rows[0]).toEqual({ n: 0 });
  });
});

describe("quote events", () => {
  it("appear on the deal, and on its company", async () => {
    await db.execute(sql`
      insert into quote (id, quote_number, deal_id, company_id, subtotal, total_amount)
      values ('q1', 'Q-1', 'd1', 'co1', '100', '122')`);
    await db.execute(sql`
      insert into quote_activity (id, quote_id, type, user_id, created_at) values ('qa1', 'q1', 'sent', 'anna', ${ago(2)})`);

    const onDeal = (await loadRecordTimeline(db as never, { type: "deal", id: "d1" })).items;
    expect(onDeal).toEqual([
      expect.objectContaining({ kind: "quote", quoteNumber: "Q-1", event: "sent", byName: "Anna" }),
    ]);
    const onCompany = (await loadRecordTimeline(db as never, { type: "company", id: "co1" })).items;
    expect(onCompany[0]).toMatchObject({ kind: "quote", via: { type: "deal", id: "d1" } });
  });
});

describe("⚠️ paging", () => {
  it("walks the whole history in pages, losing and repeating nothing", async () => {
    for (let i = 0; i < 25; i++) await activity(`a${String(i).padStart(2, "0")}`, { company: "co1" }, ago(i + 1));
    const seen: string[] = [];
    let before: Date | undefined;
    for (let page = 0; page < 10; page++) {
      const { items, hasMore } = await loadRecordTimeline(
        db as never,
        { type: "company", id: "co1" },
        { before, limit: 10 },
      );
      seen.push(...keys(items));
      if (!hasMore || items.length === 0) break;
      before = new Date(items[items.length - 1].at);
    }
    expect(seen).toHaveLength(25);
    expect(new Set(seen).size).toBe(25);
  });

  it("⚠️ a page is the most recent happenings, not the most recently typed rows", async () => {
    // Twenty-five old calls typed in today, and yesterday's call typed long ago.
    for (let i = 0; i < 25; i++) {
      await db.execute(sql`
        insert into activity (id, type, content, date, company_id, created_at)
        values (${`old${i}`}, 'call', 'x', ${ago(40 + i)}, 'co1', now())`);
    }
    await db.execute(sql`
      insert into activity (id, type, content, date, company_id, created_at)
      values ('yesterday', 'call', 'x', ${ago(1)}, 'co1', ${ago(60)})`);

    const { items } = await loadRecordTimeline(db as never, { type: "company", id: "co1" }, { limit: 1 });
    expect(items[0].key).toBe("a:yesterday");
  });

  it("⚠️ never cuts a save's field changes in half", async () => {
    await recordFieldChanges(
      db as never,
      "company",
      "co1",
      { name: "A", city: "Genova", website: "a.it", industry: "x" },
      { name: "B", city: "Savona", website: "b.it", industry: "y" },
      "anna",
    );
    const { items } = await loadRecordTimeline(db as never, { type: "company", id: "co1" }, { limit: 2 });
    expect(items).toHaveLength(4);
  });
});

describe("the summary", () => {
  it("counts what the list holds, and knows the last contact that has happened", async () => {
    await activity("past", { deal: "d1" }, ago(3));
    await activity("booked", { company: "co1" }, new Date(Date.now() + 5 * DAY), "meeting");
    await recordFieldChanges(db as never, "company", "co1", { city: "A" }, { city: "B" }, "anna");

    const summary = await recordTimelineSummary(db as never, { type: "company", id: "co1" });
    expect(summary.count).toBe(3);
    expect(Math.round((Date.now() - (summary.lastContactAt?.getTime() ?? 0)) / DAY)).toBe(3);
  });
});
