import { inArray } from "drizzle-orm";

import { companies, contacts, deals, leads, tasks, tickets } from "@/db/schema";

/**
 * Who to call about a row of the work list, and how: the person behind a deal, a lead, a
 * company, a reply owed or a ticket — found for the whole list in a handful of queries.
 *
 * The work queue shows this beside the outcome form, because the number to dial is the one
 * thing a salesperson needs from the record and had to open the record to find.
 */

// biome-ignore lint/suspicious/noExplicitAny: Drizzle's database types differ per driver
type AnyDb = any;

export interface Reach {
  name: string | null;
  phone: string | null;
  email: string | null;
  /** The record the contact is logged on. */
  target: { entity: "deal" | "lead" | "company" | "contact"; id: string } | null;
}

export type ReachKey = { entity: "deal" | "lead" | "company" | "task" | "ticket" | "quote"; id: string };

const NOBODY: Reach = { name: null, phone: null, email: null, target: null };

export async function reachFor(db: AnyDb, keys: ReachKey[]): Promise<Map<string, Reach>> {
  const out = new Map<string, Reach>();
  const ids = (entity: ReachKey["entity"]) => [...new Set(keys.filter((k) => k.entity === entity).map((k) => k.id))];

  // Tasks and tickets point at a contact or a lead; deals at a contact and a company.
  const taskRows = ids("task").length
    ? await db
        .select({ id: tasks.id, contactId: tasks.contactId, leadId: tasks.leadId, dealId: tasks.dealId })
        .from(tasks)
        .where(inArray(tasks.id, ids("task")))
    : [];
  const ticketRows = ids("ticket").length
    ? await db
        .select({ id: tickets.id, contactId: tickets.contactId })
        .from(tickets)
        .where(inArray(tickets.id, ids("ticket")))
    : [];
  const dealIds = [
    ...new Set([...ids("deal"), ...taskRows.map((t: { dealId: string | null }) => t.dealId).filter(Boolean)]),
  ];
  const dealRows = dealIds.length
    ? await db
        .select({ id: deals.id, contactId: deals.contactId, companyId: deals.companyId })
        .from(deals)
        .where(inArray(deals.id, dealIds))
    : [];

  const contactIds = [
    ...new Set(
      [
        ...taskRows.map((t: { contactId: string | null }) => t.contactId),
        ...ticketRows.map((t: { contactId: string | null }) => t.contactId),
        ...dealRows.map((d: { contactId: string | null }) => d.contactId),
      ].filter(Boolean),
    ),
  ] as string[];
  const leadIds = [
    ...new Set([...ids("lead"), ...taskRows.map((t: { leadId: string | null }) => t.leadId).filter(Boolean)]),
  ] as string[];
  const companyIds = [
    ...new Set([...ids("company"), ...dealRows.map((d: { companyId: string | null }) => d.companyId).filter(Boolean)]),
  ] as string[];

  const [contactRows, leadRows, companyRows] = await Promise.all([
    contactIds.length
      ? db
          .select({
            id: contacts.id,
            first: contacts.firstName,
            last: contacts.lastName,
            phone: contacts.phone,
            mobile: contacts.mobile,
            email: contacts.email,
          })
          .from(contacts)
          .where(inArray(contacts.id, contactIds))
      : [],
    leadIds.length
      ? db
          .select({
            id: leads.id,
            first: leads.firstName,
            last: leads.lastName,
            phone: leads.phone,
            mobile: leads.mobile,
            email: leads.email,
          })
          .from(leads)
          .where(inArray(leads.id, leadIds))
      : [],
    companyIds.length
      ? db
          .select({ id: companies.id, name: companies.name, phone: companies.mainPhone, email: companies.mainEmail })
          .from(companies)
          .where(inArray(companies.id, companyIds))
      : [],
  ]);

  type Person = {
    id: string;
    first: string | null;
    last: string | null;
    phone: string | null;
    mobile: string | null;
    email: string | null;
  };
  const person = (p: Person | undefined, entity: "contact" | "lead"): Reach | null =>
    p
      ? {
          name: `${p.first ?? ""} ${p.last ?? ""}`.trim() || null,
          // The mobile first: a salesperson dialling from the queue is on a phone.
          phone: p.mobile || p.phone || null,
          email: p.email || null,
          target: { entity, id: p.id },
        }
      : null;
  const contactOf = (id: string | null) =>
    person(
      contactRows.find((c: Person) => c.id === id),
      "contact",
    );
  const leadOf = (id: string | null) =>
    person(
      leadRows.find((l: Person) => l.id === id),
      "lead",
    );
  const companyOf = (id: string | null): Reach | null => {
    const c = companyRows.find((r: { id: string }) => r.id === id);
    return c
      ? { name: c.name, phone: c.phone ?? null, email: c.email ?? null, target: { entity: "company", id: c.id } }
      : null;
  };

  for (const k of keys) {
    const key = `${k.entity}:${k.id}`;
    if (k.entity === "lead") out.set(key, leadOf(k.id) ?? NOBODY);
    else if (k.entity === "company") out.set(key, companyOf(k.id) ?? NOBODY);
    else if (k.entity === "deal") {
      const d = dealRows.find((r: { id: string }) => r.id === k.id);
      const who = contactOf(d?.contactId ?? null) ?? companyOf(d?.companyId ?? null);
      // Logged on the deal, whoever is dialled.
      out.set(
        key,
        who ? { ...who, target: { entity: "deal", id: k.id } } : { ...NOBODY, target: { entity: "deal", id: k.id } },
      );
    } else if (k.entity === "task") {
      const t = taskRows.find((r: { id: string }) => r.id === k.id);
      // A call planned on a deal dials the deal's person: the task names only the deal.
      const d = t?.dealId ? dealRows.find((r: { id: string }) => r.id === t.dealId) : undefined;
      out.set(
        key,
        contactOf(t?.contactId ?? null) ??
          leadOf(t?.leadId ?? null) ??
          contactOf(d?.contactId ?? null) ??
          companyOf(d?.companyId ?? null) ??
          NOBODY,
      );
    } else if (k.entity === "ticket") {
      const t = ticketRows.find((r: { id: string }) => r.id === k.id);
      out.set(key, contactOf(t?.contactId ?? null) ?? NOBODY);
    } else out.set(key, NOBODY);
  }
  return out;
}
