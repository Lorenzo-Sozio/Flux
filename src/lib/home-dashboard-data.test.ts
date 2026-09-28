/**
 * The desk's and the money side's figures, counted on a real Postgres (PGlite).
 * A figure on a home dashboard is read as the truth about the business; one that counts
 * the wrong rows is worse than none.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";
import * as schema from "@/db/schema";

import { deskFigures, moneyFigures, moneyHeadline } from "./home-dashboard-data";

const db = drizzle(new PGlite(), { schema });
const NOW = new Date("2026-09-28T10:00:00Z");
const hours = (h: number) => new Date(NOW.getTime() + h * 3_600_000);

beforeAll(async () => {
  await applyTenantMigrations(db as never);
}, 120_000);

beforeEach(async () => {
  await db.execute(sql`delete from order_payment`);
  await db.execute(sql`delete from deal`);
  await db.execute(sql`delete from ticket`);
  await db.execute(sql`delete from invoice`);
  await db.execute(sql`delete from "order"`);
  await db.execute(sql`delete from "user"`);
  await db.execute(sql`insert into "user" (id, name, email) values ('anna', 'Anna', 'a@x.it')`);
});

async function ticket(
  id: string,
  fields: {
    status?: string;
    assignee?: string | null;
    deadline?: Date | null;
    breached?: Date | null;
    rated?: [string, Date];
  },
) {
  await db.insert(schema.tickets).values({
    id,
    ticketNumber: id.toUpperCase(),
    subject: `Ticket ${id}`,
    channel: "email",
    status: fields.status ?? "open",
    assigneeId: fields.assignee ?? null,
    slaDeadlineAt: fields.deadline ?? null,
    slaBreachedAt: fields.breached ?? null,
    csatRating: fields.rated?.[0] ?? null,
    csatRatedAt: fields.rated?.[1] ?? null,
  } as never);
}

describe("the support desk", () => {
  it("counts open, unassigned, late and due soon — and nothing closed", async () => {
    await ticket("t1", { assignee: "anna", deadline: hours(-1) }); // late by its deadline
    await ticket("t2", { deadline: hours(10), breached: hours(-2) }); // stamped breached
    await ticket("t3", { deadline: hours(2) }); // due soon, unassigned
    await ticket("t4", { deadline: hours(30) }); // fine, unassigned
    await ticket("t5", { status: "resolved", deadline: hours(-5) }); // closed: not counted

    const f = await deskFigures(db, "anna", NOW);
    expect(f).toMatchObject({ open: 4, mine: 1, unassigned: 3, late: 2, dueSoon: 1 });
    expect(f.myNextDue.map((x) => x.id)).toEqual(["t1"]);
  });

  it("lists the nearest deadlines first, with who has them", async () => {
    await ticket("t1", { deadline: hours(20) });
    await ticket("t2", { assignee: "anna", deadline: hours(-1) });
    await ticket("t3", {});
    const f = await deskFigures(db, "anna", NOW);
    expect(f.nextDue.map((t) => [t.id, t.late, t.assigneeName])).toEqual([
      ["t2", true, "Anna"],
      ["t1", false, null],
      ["t3", false, null],
    ]);
  });

  it("counts the satisfaction of the last thirty days only", async () => {
    await ticket("t1", { status: "closed", rated: ["good", hours(-24)] });
    await ticket("t2", { status: "closed", rated: ["bad", hours(-48)] });
    await ticket("t3", { status: "closed", rated: ["good", hours(-24 * 40)] });
    expect((await deskFigures(db, "anna", NOW)).csat).toEqual({ good: 1, bad: 1 });
  });
});

describe("the money side", () => {
  it("⚠️ counts as to invoice only completed orders nobody has started an invoice for", async () => {
    for (const [id, status] of [
      ["o1", "completed"],
      ["o2", "completed"],
      ["o3", "completed"],
      ["o4", "processing"],
    ] as const) {
      await db
        .insert(schema.orders)
        .values({ id, orderNumber: id, status, subtotal: "0", totalAmount: "0", taxAmount: "0" } as never);
    }
    await db.insert(schema.invoices).values({ id: "i1", orderId: "o1", status: "issued" } as never);
    await db.insert(schema.invoices).values({ id: "i2", orderId: "o2", status: "draft" } as never);
    await db.insert(schema.invoices).values({ id: "i3", status: "draft" } as never);

    expect(await moneyFigures(db)).toEqual({ ordersToInvoice: 1, draftInvoices: 2 });
  });
});

describe("⚠️⚠️ the money dashboard's four figures", () => {
  const ZONE = "Europe/Rome";

  it("counts won this month, this year and ever, by when each deal closed", async () => {
    const won = [
      ["d1", "1000", "2026-09-10T10:00:00Z"],
      ["d2", "500", "2026-03-01T10:00:00Z"],
      ["d3", "250", "2025-12-31T10:00:00Z"],
    ];
    for (const [id, amount, closed] of won) {
      await db.execute(
        sql`insert into deal (id, name, amount, status, closed_at) values (${id}, ${id}, ${amount}, 'won', ${closed})`,
      );
    }
    await db.execute(sql`insert into deal (id, name, amount, status) values ('d4', 'd4', '9999', 'open')`);

    const h = await moneyHeadline(db, NOW, ZONE);
    expect(h.won).toEqual({ month: 1000, year: 1500, allTime: 1750, allTimeCount: 3 });
  });

  it("invoices what was issued, taxable, less credit notes — never a draft, never two currencies summed", async () => {
    const rows: [string, string, string, string, string, string][] = [
      ["i1", "issued", "TD01", "EUR", "1000", "2026-09-05"],
      ["i2", "issued", "TD04", "EUR", "200", "2026-09-06"], // a credit note takes back
      ["i3", "issued", "TD01", "EUR", "300", "2026-02-01"], // this year, not this month
      ["i4", "draft", "TD01", "EUR", "5000", "2026-09-07"], // not revenue yet
      ["i5", "issued", "TD01", "USD", "400", "2026-09-08"],
      ["i6", "issued", "TD01", "EUR", "700", "2025-11-01"], // last year
    ];
    for (const [id, status, type, currency, taxable, issued] of rows) {
      await db.insert(schema.invoices).values({
        id,
        status,
        documentType: type,
        currency,
        taxableAmount: taxable,
        issueDate: issued,
      } as never);
    }
    const h = await moneyHeadline(db, NOW, ZONE);
    expect(h.invoiced.month).toEqual([
      { currency: "EUR", amount: 800 },
      { currency: "USD", amount: 400 },
    ]);
    expect(h.invoiced.year).toEqual([
      { currency: "EUR", amount: 1100 },
      { currency: "USD", amount: 400 },
    ]);
  });

  it("collects every payment, an order's too, in the currency of what it paid", async () => {
    await db.insert(schema.orders).values({
      id: "o1",
      orderNumber: "o1",
      status: "completed",
      currency: "USD",
      subtotal: "0",
      totalAmount: "0",
      taxAmount: "0",
    } as never);
    await db.insert(schema.invoices).values({ id: "i1", status: "issued", currency: "EUR" } as never);
    await db.insert(schema.orderPayments).values([
      { id: "p1", invoiceId: "i1", amount: "600", paidAt: new Date("2026-09-15T10:00:00Z") },
      { id: "p2", orderId: "o1", amount: "50", paidAt: new Date("2026-09-20T10:00:00Z") },
      { id: "p3", invoiceId: "i1", amount: "100", paidAt: new Date("2026-01-15T10:00:00Z") },
      { id: "p4", invoiceId: "i1", amount: "999", paidAt: new Date("2025-06-15T10:00:00Z") },
    ] as never);
    const h = await moneyHeadline(db, NOW, ZONE);
    expect(h.collected.month).toEqual([
      { currency: "EUR", amount: 600 },
      { currency: "USD", amount: 50 },
    ]);
    expect(h.collected.year).toEqual([
      { currency: "EUR", amount: 700 },
      { currency: "USD", amount: 50 },
    ]);
  });
});
