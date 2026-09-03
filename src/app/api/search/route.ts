import { type NextRequest, NextResponse } from "next/server";

import { ilike, or, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import { auth } from "@/auth";
import { companies, contacts, deals, leads, orders, quotes, tickets } from "@/db/schema";
import { getDb } from "@/lib/tenant-context";

export async function GET(req: NextRequest) {
  const db = await getDb();
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q || q.length < 2) return NextResponse.json({ results: [] });

  const like = `%${q}%`;

  // "Mario Rossi" used to return nothing: the term was compared separately with
  // the first name and the last name, and matched neither in full. Searching the
  // concatenation is what people actually type (audit rilievo U-04).
  const fullName = (first: AnyPgColumn, last: AnyPgColumn) =>
    sql`lower(coalesce(${first}, '') || ' ' || coalesce(${last}, '')) LIKE lower(${like})`;

  // A phone number arriving on screen is the second most common thing to look up,
  // and neither phone column was searched at all. Digits are compared with the
  // formatting stripped, so "+39 02 1234567" is found by "021234567".
  const digits = q.replace(/\D/g, "");
  const phoneLike = digits.length >= 4 ? `%${digits}%` : null;
  const phoneMatch = (col: AnyPgColumn) =>
    phoneLike ? sql`regexp_replace(coalesce(${col}, ''), '[^0-9]', '', 'g') LIKE ${phoneLike}` : undefined;

  const [foundContacts, foundLeads, foundCompanies, foundDeals, foundTickets, foundQuotes, foundOrders] =
    await Promise.all([
      db
        .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName, email: contacts.email })
        .from(contacts)
        .where(
          or(
            ilike(contacts.firstName, like),
            ilike(contacts.lastName, like),
            fullName(contacts.firstName, contacts.lastName),
            ilike(contacts.email, like),
            phoneMatch(contacts.phone),
            phoneMatch(contacts.mobile),
          ),
        )
        .limit(5),

      db
        .select({
          id: leads.id,
          firstName: leads.firstName,
          lastName: leads.lastName,
          email: leads.email,
          companyName: leads.companyName,
        })
        .from(leads)
        .where(
          or(
            ilike(leads.firstName, like),
            ilike(leads.lastName, like),
            fullName(leads.firstName, leads.lastName),
            ilike(leads.email, like),
            ilike(leads.companyName, like),
            phoneMatch(leads.phone),
            phoneMatch(leads.mobile),
          ),
        )
        .limit(5),

      db
        .select({ id: companies.id, name: companies.name, industry: companies.industry })
        .from(companies)
        .where(
          or(
            ilike(companies.name, like),
            ilike(companies.industry, like),
            ilike(companies.vatNumber, like),
            phoneMatch(companies.mainPhone),
            ilike(companies.mainEmail, like),
          ),
        )
        .limit(5),

      db
        .select({ id: deals.id, name: deals.name, status: deals.status })
        .from(deals)
        .where(ilike(deals.name, like))
        .limit(5),

      db
        .select({
          id: tickets.id,
          ticketNumber: tickets.ticketNumber,
          subject: tickets.subject,
          status: tickets.status,
        })
        .from(tickets)
        .where(or(ilike(tickets.subject, like), ilike(tickets.ticketNumber, like)))
        .limit(5),

      db
        .select({ id: quotes.id, quoteNumber: quotes.quoteNumber, status: quotes.status })
        .from(quotes)
        .where(ilike(quotes.quoteNumber, like))
        .limit(5),

      db
        .select({ id: orders.id, orderNumber: orders.orderNumber, status: orders.status })
        .from(orders)
        .where(ilike(orders.orderNumber, like))
        .limit(5),
    ]);

  return NextResponse.json({
    results: {
      contacts: foundContacts.map((c) => ({
        id: c.id,
        label: `${c.firstName} ${c.lastName}`,
        sub: c.email,
        url: `/dashboard/contacts/${c.id}`,
        entity: "contact",
      })),
      leads: foundLeads.map((l) => ({
        id: l.id,
        label: `${l.firstName} ${l.lastName}`,
        sub: l.companyName ?? l.email,
        url: `/dashboard/leads/${l.id}`,
        entity: "lead",
      })),
      companies: foundCompanies.map((c) => ({
        id: c.id,
        label: c.name,
        sub: c.industry,
        url: `/dashboard/companies/${c.id}`,
        entity: "company",
      })),
      deals: foundDeals.map((d) => ({
        id: d.id,
        label: d.name,
        sub: d.status,
        url: `/dashboard/pipeline/${d.id}`,
        entity: "deal",
      })),
      tickets: foundTickets.map((t) => ({
        id: t.id,
        label: t.subject,
        sub: t.ticketNumber,
        url: `/dashboard/support/tickets/${t.id}`,
        entity: "ticket",
      })),
      quotes: foundQuotes.map((q) => ({
        id: q.id,
        label: q.quoteNumber,
        sub: q.status,
        url: `/dashboard/sales/quotes/${q.id}`,
        entity: "quote",
      })),
      orders: foundOrders.map((o) => ({
        id: o.id,
        label: o.orderNumber,
        sub: o.status,
        url: `/dashboard/sales/orders/${o.id}`,
        entity: "order",
      })),
    },
  });
}
