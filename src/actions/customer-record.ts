"use server";

import { and, desc, eq, isNull, or, type SQL } from "drizzle-orm";

import { deals, orders, quotes, tickets } from "@/db/schema";
import { getTenantEntitlements, requireCapability } from "@/lib/auth-guard";
import { getDb } from "@/lib/tenant-context";

/**
 * What is happening commercially with one customer.
 *
 * The company and contact pages showed notes, tasks, documents and custom fields
 * — everything written *about* a customer and nothing that was ever *sold* to
 * them. To find out whether a company had an open quote, or which of its orders
 * was still unfinished, the only route was the orders list and a search box. The
 * question a CRM exists to answer was the one its customer page could not.
 *
 * Five of each, newest first, and a sixth read only to know whether to offer the
 * full list. Counting exactly would be four more queries for a number nobody
 * acts on.
 */

const PAGE = 5;

export interface CustomerRecordRow {
  id: string;
  label: string;
  sub: string | null;
  status: string;
  amount: number | null;
  href: string;
}

export interface CustomerRecord {
  deals: CustomerRecordRow[];
  quotes: CustomerRecordRow[];
  orders: CustomerRecordRow[];
  tickets: CustomerRecordRow[];
  /** True when more exist than are shown, so the panel can offer the full list. */
  more: { deals: boolean; quotes: boolean; orders: boolean; tickets: boolean };
  /** A module the plan does not include is absent, not empty, and must not read as empty. */
  modules: { sales: boolean; support: boolean };
}

const EMPTY: CustomerRecord = {
  deals: [],
  quotes: [],
  orders: [],
  tickets: [],
  more: { deals: false, quotes: false, orders: false, tickets: false },
  modules: { sales: false, support: false },
};

function take(rows: CustomerRecordRow[]) {
  return { rows: rows.slice(0, PAGE), more: rows.length > PAGE };
}

/**
 * @param scope exactly one of companyId or contactId. A contact's record is the
 * contact's own; it deliberately does not widen to everything their company has,
 * because "what did this person buy" and "what did their employer buy" are
 * different questions and only one of them was asked.
 */
export async function getCustomerRecord(scope: { companyId?: string; contactId?: string }): Promise<CustomerRecord> {
  await requireCapability("record:read");

  const where = <T extends { companyId: unknown; contactId: unknown }>(t: T): SQL | undefined =>
    scope.companyId
      ? eq(t.companyId as never, scope.companyId)
      : scope.contactId
        ? eq(t.contactId as never, scope.contactId)
        : undefined;

  const clause = where({ companyId: deals.companyId, contactId: deals.contactId });
  if (!clause) return EMPTY;

  const entitlements = await getTenantEntitlements().catch(() => null);
  const modules = {
    sales: entitlements ? entitlements.enabledModules.includes("sales") : true,
    support: entitlements ? entitlements.enabledModules.includes("support") : true,
  };

  const db = await getDb();

  const dealRows = await db
    .select({
      id: deals.id,
      name: deals.name,
      amount: deals.amount,
      status: deals.status,
      expectedCloseDate: deals.expectedCloseDate,
    })
    .from(deals)
    .where(where({ companyId: deals.companyId, contactId: deals.contactId }))
    .orderBy(desc(deals.createdAt))
    .limit(PAGE + 1);

  const quoteRows = modules.sales
    ? await db
        .select({ id: quotes.id, number: quotes.quoteNumber, status: quotes.status, total: quotes.totalAmount })
        .from(quotes)
        .where(where({ companyId: quotes.companyId, contactId: quotes.contactId }))
        .orderBy(desc(quotes.createdAt))
        .limit(PAGE + 1)
    : [];

  const orderRows = modules.sales
    ? await db
        .select({ id: orders.id, number: orders.orderNumber, status: orders.status, total: orders.totalAmount })
        .from(orders)
        .where(where({ companyId: orders.companyId, contactId: orders.contactId }))
        .orderBy(desc(orders.createdAt))
        .limit(PAGE + 1)
    : [];

  const ticketRows = modules.support
    ? await db
        .select({
          id: tickets.id,
          number: tickets.ticketNumber,
          subject: tickets.subject,
          status: tickets.status,
          breached: tickets.slaBreachedAt,
        })
        .from(tickets)
        .where(
          and(
            where({ companyId: tickets.companyId, contactId: tickets.contactId }),
            // Anything still open first; closed ones are history and the timeline
            // below already carries the shape of the relationship.
            or(isNull(tickets.closedAt), eq(tickets.status, "closed")),
          ),
        )
        .orderBy(desc(tickets.createdAt))
        .limit(PAGE + 1)
    : [];

  const d = take(
    dealRows.map((r) => ({
      id: r.id,
      label: r.name,
      sub: r.expectedCloseDate ? new Date(r.expectedCloseDate).toISOString().slice(0, 10) : null,
      status: r.status,
      amount: Number(r.amount ?? 0),
      href: `/dashboard/pipeline/${r.id}`,
    })),
  );
  const q = take(
    quoteRows.map((r) => ({
      id: r.id,
      label: r.number,
      sub: null,
      status: r.status,
      amount: Number(r.total ?? 0),
      href: `/dashboard/sales/quotes/${r.id}`,
    })),
  );
  const o = take(
    orderRows.map((r) => ({
      id: r.id,
      label: r.number,
      sub: null,
      status: r.status,
      amount: Number(r.total ?? 0),
      href: `/dashboard/sales/orders/${r.id}`,
    })),
  );
  const tk = take(
    ticketRows.map((r) => ({
      id: r.id,
      label: r.number,
      sub: r.subject,
      status: r.breached ? "breached" : r.status,
      amount: null,
      href: `/dashboard/support/tickets/${r.id}`,
    })),
  );

  return {
    deals: d.rows,
    quotes: q.rows,
    orders: o.rows,
    tickets: tk.rows,
    more: { deals: d.more, quotes: q.more, orders: o.more, tickets: tk.more },
    modules,
  };
}
