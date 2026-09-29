import { and, eq, notExists, or, type SQL, sql } from "drizzle-orm";

import { invoices, orders } from "@/db/schema";

// biome-ignore lint/suspicious/noExplicitAny: accepts both the Neon and the PGlite database handle.
type AnyDb = any;

/**
 * A completed order with nothing invoicing it: the home's "to invoice" figure and the orders
 * list's filter of the same name, one condition so the number and the list it opens agree.
 *
 * Invoicing it means an invoice (TD01) in draft — somebody's work in progress — or issued and
 * not credited back in full. A deposit invoice (TD02) leaves the rest to invoice (I11), and an
 * invoice credited in full invoices nothing: the order is to invoice again.
 */
export function stillToInvoice(db: AnyDb): SQL {
  return and(
    eq(orders.status, "completed"),
    notExists(
      db
        .select({ one: sql`1` })
        .from(invoices)
        .where(
          and(
            eq(invoices.orderId, orders.id),
            eq(invoices.documentType, "TD01"),
            or(eq(invoices.status, "draft"), sql`${invoices.creditedAmount} < ${invoices.total}`),
          ),
        ),
    ),
  ) as SQL;
}
