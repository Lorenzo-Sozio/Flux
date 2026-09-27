import { eq } from "drizzle-orm";

import { companies, contacts, deals, leads, orders, tickets, users } from "@/db/schema";
import { getDb } from "@/lib/tenant-context";

import type { RuleContext } from "./types";

/**
 * What `{{…}}` can name in an automation's email or webhook.
 *
 * ⚠️⚠️ **The builder promises `{{contact.email}}`, `{{deal.name}}` and `{{owner.name}}`,
 * so those are what resolve.** The record used to be spread flat: only `{{email}}` and
 * `{{name}}` worked, `{{contact.email}}` stayed literal, and the send failed with
 * "Invalid recipient email after merge" — for the address the recipient field suggests
 * by default. A rule on a deal could not reach the deal's contact at all.
 *
 * The record is here three ways, so no rule written against any earlier shape breaks:
 * flat (`{{email}}`), under its own type (`{{lead.email}}`), and — for the records it
 * points at — its contact and company (`{{contact.email}}`, `{{company.name}}` on a
 * deal, a ticket or an order).
 *
 * ⚠️⚠️ **The owner is three columns, never the row.** The whole `user` row carries the
 * password hash and the secret address of that person's calendar, and a template is
 * text anybody who can edit a rule can write: `{{owner.password}}` would have mailed
 * the hash to a customer.
 */
export async function loadMergeData(context: RuleContext): Promise<Record<string, unknown>> {
  const db = await getDb();

  const record = (await readRecord(context.entityType, context.entityId)) ?? context.newData ?? {};
  const self = withName(record);

  const data: Record<string, unknown> = {
    ...self,
    [context.entityType]: self,
    entityId: context.entityId,
    entityType: context.entityType,
  };

  if (context.entityType !== "contact" && typeof record.contactId === "string") {
    const [contact] = await db.select().from(contacts).where(eq(contacts.id, record.contactId));
    if (contact) data.contact = withName(contact);
  }
  if (context.entityType !== "company" && typeof record.companyId === "string") {
    const [company] = await db.select().from(companies).where(eq(companies.id, record.companyId));
    if (company) data.company = company;
  }
  if (typeof record.ownerId === "string") {
    const [owner] = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, record.ownerId));
    if (owner) data.owner = owner;
  }

  data.createdAt = isoOrUndefined(record.createdAt);
  data.updatedAt = isoOrUndefined(record.updatedAt);
  return data;
}

async function readRecord(entityType: string, id: string): Promise<Record<string, unknown> | null> {
  const db = await getDb();
  switch (entityType) {
    case "deal":
      return (await db.select().from(deals).where(eq(deals.id, id)))[0] ?? null;
    case "lead":
      return (await db.select().from(leads).where(eq(leads.id, id)))[0] ?? null;
    case "contact":
      return (await db.select().from(contacts).where(eq(contacts.id, id)))[0] ?? null;
    case "company":
      return (await db.select().from(companies).where(eq(companies.id, id)))[0] ?? null;
    case "ticket":
      return (await db.select().from(tickets).where(eq(tickets.id, id)))[0] ?? null;
    case "order":
      return (await db.select().from(orders).where(eq(orders.id, id)))[0] ?? null;
    default:
      return null;
  }
}

/** A person's full name as `{{contact.name}}`, which the builder has always advertised. */
function withName<T extends Record<string, unknown>>(row: T): T & { name?: unknown } {
  if (row.name !== undefined && row.name !== null) return row;
  const full = [row.firstName, row.lastName].filter((p) => typeof p === "string" && p.trim()).join(" ");
  return full ? { ...row, name: full } : row;
}

function isoOrUndefined(value: unknown): string | undefined {
  return value instanceof Date ? value.toISOString() : typeof value === "string" ? value : undefined;
}
