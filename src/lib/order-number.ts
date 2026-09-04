import { sql } from "drizzle-orm";

import { orders } from "@/db/schema";

/**
 * The next order number, in sequence.
 *
 * An order used to carry a random UUID as its number, so two orders placed a minute apart
 * were unrelated strings: nobody could tell which came first, a gap could not be spotted,
 * and a customer received a document whose number carries no sequence — which is not what a
 * commercial document is for (audit rilievo C-05).
 *
 * Derived from the highest number already issued this year, so it survives the absence of a
 * database sequence and stays readable: ORD-2026-0007.
 *
 * ## ⚠️ Why it lives here and not next to the order actions
 *
 * Because a second caller arrived — the API route that records an order taken by the
 * assistant — and a second implementation of a numbering sequence is the way two orders end
 * up sharing a number. It could not simply be exported from the actions file either: that
 * module is `"use server"`, where every export becomes an endpoint anyone can call, and
 * «give me the next order number» is not something to publish.
 */
// biome-ignore lint/suspicious/noExplicitAny: the tenant db handle is built per request
export async function nextOrderNumber(db: any): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `ORD-${year}-`;

  const [row] = await db
    .select({ last: sql<string | null>`max(${orders.orderNumber})` })
    .from(orders)
    .where(sql`${orders.orderNumber} LIKE ${`${prefix}%`}`);

  const lastSeq = row?.last ? Number.parseInt(row.last.slice(prefix.length), 10) : 0;
  const next = Number.isFinite(lastSeq) ? lastSeq + 1 : 1;
  return `${prefix}${String(next).padStart(4, "0")}`;
}
