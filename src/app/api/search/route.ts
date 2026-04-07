import { auth } from "@/auth";
import { db } from "@/db";
import { companies, contacts, deals, leads } from "@/db/schema";
import { ilike, or } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q || q.length < 2) return NextResponse.json({ results: [] });

  const like = `%${q}%`;

  const [foundContacts, foundLeads, foundCompanies, foundDeals] = await Promise.all([
    db
      .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName, email: contacts.email, type: contacts.status })
      .from(contacts)
      .where(or(ilike(contacts.firstName, like), ilike(contacts.lastName, like), ilike(contacts.email, like)))
      .limit(5),

    db
      .select({ id: leads.id, firstName: leads.firstName, lastName: leads.lastName, email: leads.email, companyName: leads.companyName })
      .from(leads)
      .where(or(ilike(leads.firstName, like), ilike(leads.lastName, like), ilike(leads.email, like), ilike(leads.companyName, like)))
      .limit(5),

    db
      .select({ id: companies.id, name: companies.name, industry: companies.industry })
      .from(companies)
      .where(or(ilike(companies.name, like), ilike(companies.industry, like)))
      .limit(5),

    db
      .select({ id: deals.id, name: deals.name, amount: deals.amount, status: deals.status })
      .from(deals)
      .where(ilike(deals.name, like))
      .limit(5),
  ]);

  return NextResponse.json({
    results: {
      contacts: foundContacts.map((c) => ({ ...c, label: `${c.firstName} ${c.lastName}`, sub: c.email, url: `/dashboard/contacts/${c.id}`, entity: "contact" })),
      leads: foundLeads.map((l) => ({ ...l, label: `${l.firstName} ${l.lastName}`, sub: l.companyName ?? l.email, url: `/dashboard/leads/${l.id}`, entity: "lead" })),
      companies: foundCompanies.map((c) => ({ ...c, label: c.name, sub: c.industry, url: `/dashboard/companies/${c.id}`, entity: "company" })),
      deals: foundDeals.map((d) => ({ ...d, label: d.name, sub: d.status, url: `/dashboard/pipeline/${d.id}`, entity: "deal" })),
    },
  });
}
