import { and, eq, gte, lte, notInArray, type SQL, sql } from "drizzle-orm";

import { deals, orders, quotes, tickets } from "@/db/schema";
import { CLOSED_TICKET_STATUSES } from "@/lib/ticket-states";
import { addDaysToDate, fromWallValue } from "@/lib/wall-clock";

/**
 * One definition per number, read by every screen that shows it.
 *
 * ⚠️⚠️ Home, Reports, Finance and the Pipeline pages each computed the same figures their
 * own way, and none of them was obviously wrong on its own — which is why nobody noticed
 * until two people brought two numbers to the same meeting:
 *
 *  - **won this period** was dated by `updatedAt` on four screens and by `closedAt` on
 *    three, so re-saving a deal won in March moved it into September's revenue;
 *  - **revenue** added won deals to completed orders, while turning a quote into an order
 *    marks its deal won — the same sale, counted twice;
 *  - **win rate** was won ÷ *created* on one screen (it could pass 100%) and won ÷ (won +
 *    lost) on the others;
 *  - **open tickets** left out `new` — every ticket arrives as `new` — on one screen,
 *    counted only `open` on another, and a third used yet another list;
 *  - document totals in different currencies were added together as if they were euros.
 *
 * The definitions below are the ones that answer the question people are asking.
 */

// ── Deals ───────────────────────────────────────────────────────────────────

/**
 * Deals closed as `status` between `from` and `to`, dated by when they closed.
 * `closedAt` is written when a deal is won or lost and cleared when it is reopened.
 */
export function closedBetween(status: "won" | "lost", from?: Date, to?: Date): SQL {
  return and(
    eq(deals.status, status),
    ...(from ? [gte(deals.closedAt, from)] : []),
    ...(to ? [lte(deals.closedAt, to)] : []),
  ) as SQL;
}

/**
 * Won ÷ (won + lost), in whole percent, over deals closed in the same period — the share
 * of decided deals that went our way. Null when nothing was decided: "0%" would read as
 * "we lose everything".
 */
export function winRatePercent(won: number, lost: number): number | null {
  const decided = won + lost;
  return decided > 0 ? Math.round((won / decided) * 100) : null;
}

/** A deal's value in EUR — the column is EUR at rest (src/lib/deal-amount.ts). */
export const dealEur = sql<number>`coalesce(cast(${deals.amount} as numeric), 0)`;

// ── Documents ───────────────────────────────────────────────────────────────

/** A quote's total in EUR, at the rate captured when it was written. */
export const quoteEur = sql<number>`cast(${quotes.totalAmount} as numeric) * coalesce(cast(${quotes.eurRate} as numeric), 1)`;

/**
 * An order's total in EUR: as it is when the order is in EUR, at its quote's rate when it
 * came from one, and **null** when neither is known — never the foreign figure passed off
 * as euros. Callers count the nulls and say so.
 */
export const orderEur = sql<number | null>`case
  when ${orders.currency} = 'EUR' then cast(${orders.totalAmount} as numeric)
  else cast(${orders.totalAmount} as numeric) * (select cast(q.eur_rate as numeric) from ${quotes} q where q.id = ${orders.quoteId})
end`;

// ── Tickets ─────────────────────────────────────────────────────────────────

export { CLOSED_TICKET_STATUSES };

export function ticketIsOpen(): SQL {
  return notInArray(tickets.status, [...CLOSED_TICKET_STATUSES]);
}

// ── Periods ─────────────────────────────────────────────────────────────────

/**
 * A report's `from`/`to` (YYYY-MM-DD, both inclusive) as instants, on the workspace's clock.
 *
 * ⚠️ `new Date("2026-09-01")` is midnight in UTC, and `T23:59:59` without a zone is the
 * server's: on Workers both are UTC, so in Rome a deal won at 00:30 on the 1st was counted in
 * the month before, and one won at 23:30 on the 30th in no month at all.
 */
export function periodOf(from?: string, to?: string, timeZone = "Europe/Rome"): { from?: Date; to?: Date } {
  const start = from ? fromWallValue(from, timeZone) : null;
  const end = to ? fromWallValue(addDaysToDate(to.slice(0, 10), 1), timeZone) : null;
  return {
    from: start ?? undefined,
    // The last instant of the day: the next midnight on the workspace's clock, less a millisecond.
    to: end ? new Date(end.getTime() - 1) : undefined,
  };
}
