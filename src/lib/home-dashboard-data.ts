/**
 * The figures of the home dashboards that are not a salesperson's own day
 * (src/lib/home-dashboards.ts): the support desk, and the money side.
 *
 * Grouped statements, a few per dashboard, and each read only when its dashboard is on
 * screen. Every figure here has a list behind it that the page links to.
 */
import { and, asc, eq, gte, inArray, notExists, sql } from "drizzle-orm";

import { deals, invoices, orderPayments, orders, tickets, users } from "@/db/schema";
import { closedBetween, dealEur } from "@/lib/metrics";
import { OPEN_TICKET_STATUSES } from "@/lib/support-metrics";
import { fromWallValue, toWallDate } from "@/lib/wall-clock";
import { monthStart } from "@/lib/workspace-day";

// biome-ignore lint/suspicious/noExplicitAny: Drizzle's database types differ per driver
type AnyDb = any;

/** How soon an SLA deadline counts as close enough to act on now. */
export const SLA_SOON_HOURS = 4;
const OPEN = inArray(tickets.status, [...OPEN_TICKET_STATUSES]);

export interface DeskTicket {
  id: string;
  ticketNumber: string | null;
  subject: string;
  status: string;
  priority: string | null;
  slaDeadlineAt: Date | null;
  late: boolean;
  assigneeName: string | null;
}

export interface DeskFigures {
  open: number;
  /** Open and assigned to whoever is looking: their own queue. */
  mine: number;
  unassigned: number;
  /** Open and past the SLA: stamped breached, or its deadline gone by. */
  late: number;
  /** Open, not late yet, due within SLA_SOON_HOURS. */
  dueSoon: number;
  /** Ratings in the last thirty days. */
  csat: { good: number; bad: number };
  /** The open tickets closest to their deadline, the team's. */
  nextDue: DeskTicket[];
  /** The same, of whoever is looking. */
  myNextDue: DeskTicket[];
}

export async function deskFigures(db: AnyDb, userId: string | null, now: Date = new Date()): Promise<DeskFigures> {
  const soon = new Date(now.getTime() + SLA_SOON_HOURS * 3_600_000);
  const monthAgo = new Date(now.getTime() - 30 * 86_400_000);
  const lateNow = sql`(${tickets.slaBreachedAt} is not null or ${tickets.slaDeadlineAt} < ${now})`;

  const nearest = (mineOnly: boolean) =>
    db
      .select({
        id: tickets.id,
        ticketNumber: tickets.ticketNumber,
        subject: tickets.subject,
        status: tickets.status,
        priority: tickets.priority,
        slaDeadlineAt: tickets.slaDeadlineAt,
        late: sql<boolean>`${lateNow}`,
        assigneeName: users.name,
      })
      .from(tickets)
      .leftJoin(users, eq(users.id, tickets.assigneeId))
      .where(mineOnly ? and(OPEN, eq(tickets.assigneeId, userId ?? "")) : OPEN)
      // Nearest deadline first; a ticket with none at the end, where it cannot pass for urgent.
      .orderBy(sql`${tickets.slaDeadlineAt} asc nulls last`, asc(tickets.createdAt))
      .limit(6);

  const [[counts], [csat], nextDue, myNextDue] = await Promise.all([
    db
      .select({
        open: sql<number>`count(*)::int`,
        mine: sql<number>`count(*) filter (where ${tickets.assigneeId} = ${userId ?? ""})::int`,
        unassigned: sql<number>`count(*) filter (where ${tickets.assigneeId} is null)::int`,
        late: sql<number>`count(*) filter (where ${lateNow})::int`,
        dueSoon: sql<number>`count(*) filter (where not ${lateNow} and ${tickets.slaDeadlineAt} <= ${soon})::int`,
      })
      .from(tickets)
      .where(OPEN),
    db
      .select({
        good: sql<number>`count(*) filter (where ${tickets.csatRating} = 'good')::int`,
        bad: sql<number>`count(*) filter (where ${tickets.csatRating} = 'bad')::int`,
      })
      .from(tickets)
      .where(gte(tickets.csatRatedAt, monthAgo)),
    nearest(false),
    userId ? nearest(true) : Promise.resolve([]),
  ]);

  return {
    open: Number(counts?.open ?? 0),
    mine: Number(counts?.mine ?? 0),
    unassigned: Number(counts?.unassigned ?? 0),
    late: Number(counts?.late ?? 0),
    dueSoon: Number(counts?.dueSoon ?? 0),
    csat: { good: Number(csat?.good ?? 0), bad: Number(csat?.bad ?? 0) },
    nextDue: nextDue.map((t: DeskTicket) => ({ ...t, late: Boolean(t.late) })),
    myNextDue: myNextDue.map((t: DeskTicket) => ({ ...t, late: Boolean(t.late) })),
  };
}

export interface MoneyFigures {
  /** Invoices written and not issued yet. */
  draftInvoices: number;
  /** Completed orders no invoice has been started for. */
  ordersToInvoice: number;
}

export async function moneyFigures(db: AnyDb): Promise<MoneyFigures> {
  const [[drafts], [toInvoice]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(invoices).where(eq(invoices.status, "draft")),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(orders)
      .where(
        and(
          eq(orders.status, "completed"),
          // A draft counts as started: it is somebody's work in progress, not a forgotten order.
          notExists(db.select({ one: sql`1` }).from(invoices).where(eq(invoices.orderId, orders.id))),
        ),
      ),
  ]);
  return { draftInvoices: Number(drafts?.n ?? 0), ordersToInvoice: Number(toInvoice?.n ?? 0) };
}

/** An amount in one currency: invoiced and collected money is never converted or summed across two. */
export interface CurrencyAmount {
  currency: string;
  amount: number;
}

export interface MoneyHeadline {
  /** Won deals, closed on the workspace's clock. EUR, as every deal amount at rest. */
  won: { month: number; year: number; allTime: number; allTimeCount: number };
  /** Payments recorded, on invoices or orders, in the currency of what they paid. */
  collected: { month: CurrencyAmount[]; year: CurrencyAmount[] };
  /** Issued invoices' taxable amount (VAT excluded), less credit notes, by issue date. */
  invoiced: { month: CurrencyAmount[]; year: CurrencyAmount[] };
}

const byCurrency = (rows: { currency: string | null; amount: string | number | null }[]): CurrencyAmount[] =>
  rows
    .map((r) => ({ currency: r.currency ?? "EUR", amount: Math.round(Number(r.amount ?? 0) * 100) / 100 }))
    .filter((r) => r.amount !== 0)
    .sort((a, b) => b.amount - a.amount);

/**
 * The four figures the money dashboard leads with: won this month, won ever, collected
 * and invoiced — the last two for the month and the year so far.
 *
 * ⚠️ Invoiced is what was *issued*: a draft is not revenue, and a credit note (TD04)
 * takes back what it credits. The taxable amount, because VAT is the State's money.
 * ⚠️ Collected is every recorded payment, an order's too: money received before an
 * invoice exists is still money received.
 */
export async function moneyHeadline(db: AnyDb, now: Date, timeZone: string): Promise<MoneyHeadline> {
  const month = monthStart(now, timeZone);
  const yearFirst = `${toWallDate(now, timeZone).slice(0, 4)}-01-01`;
  const year = fromWallValue(yearFirst, timeZone) ?? month;
  const monthFirst = toWallDate(month, timeZone);

  const signed = sql`case when ${invoices.documentType} = 'TD04' then -${invoices.taxableAmount} else ${invoices.taxableAmount} end`;
  const paidIn = sql<string>`coalesce(${invoices.currency}, ${orders.currency}, 'EUR')`;

  const [[won], invoicedRows, collectedRows] = await Promise.all([
    db
      .select({
        month: sql<string>`coalesce(sum(${dealEur}) filter (where ${deals.closedAt} >= ${month}), 0)`,
        year: sql<string>`coalesce(sum(${dealEur}) filter (where ${deals.closedAt} >= ${year}), 0)`,
        allTime: sql<string>`coalesce(sum(${dealEur}), 0)`,
        count: sql<number>`count(*)::int`,
      })
      .from(deals)
      .where(closedBetween("won")),
    db
      .select({
        currency: invoices.currency,
        month: sql<string>`coalesce(sum(${signed}) filter (where ${invoices.issueDate} >= ${monthFirst}), 0)`,
        year: sql<string>`coalesce(sum(${signed}), 0)`,
      })
      .from(invoices)
      .where(and(eq(invoices.status, "issued"), gte(invoices.issueDate, yearFirst)))
      .groupBy(invoices.currency),
    db
      .select({
        currency: paidIn,
        month: sql<string>`coalesce(sum(${orderPayments.amount}) filter (where ${orderPayments.paidAt} >= ${month}), 0)`,
        year: sql<string>`coalesce(sum(${orderPayments.amount}), 0)`,
      })
      .from(orderPayments)
      .leftJoin(invoices, eq(invoices.id, orderPayments.invoiceId))
      .leftJoin(orders, eq(orders.id, orderPayments.orderId))
      .where(gte(orderPayments.paidAt, year))
      .groupBy(sql`1`),
  ]);

  const pick = (rows: { currency: string | null; month: string; year: string }[], key: "month" | "year") =>
    byCurrency(rows.map((r) => ({ currency: r.currency, amount: r[key] })));

  return {
    won: {
      month: Number(won?.month ?? 0),
      year: Number(won?.year ?? 0),
      allTime: Number(won?.allTime ?? 0),
      allTimeCount: Number(won?.count ?? 0),
    },
    invoiced: { month: pick(invoicedRows, "month"), year: pick(invoicedRows, "year") },
    collected: { month: pick(collectedRows, "month"), year: pick(collectedRows, "year") },
  };
}
