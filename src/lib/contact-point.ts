import { or, sql } from "drizzle-orm";

import { contacts, leads } from "@/db/schema";
import { digitsForMatching } from "@/lib/api-import-validators";

/**
 * Who is reachable at a contact point.
 *
 * ⚠️⚠️ **One definition, two callers.** The erasure asks it to know who to remove; the
 * engine asks it to know where to write down what it did. Two copies of «is this the same
 * person» drift, and the day they do, one of them writes a note onto somebody else while
 * the other tells them they have been deleted.
 *
 * ⚠️ Phone numbers match on digits only: a number typed with spaces and one typed without
 * are the same person. That expression is the same the deduplication uses.
 */
export interface Persona {
  leadIds: string[];
  contactIds: string[];
  email: string | null;
  digits: string | null;
}

export function perRecapito(table: typeof leads | typeof contacts, email: string | null, digits: string | null) {
  const clausole = [];
  if (email) clausole.push(sql`lower(btrim(${table.email})) = ${email}`);
  if (digits) {
    // The same expression as the deduplication: a number typed with spaces and one typed
    // without are the same person, and an erasure that missed one of the two spellings
    // would leave them in the database while telling them they are gone.
    clausole.push(
      sql`regexp_replace(coalesce(${table.phone}, ''), '[^0-9]+', '', 'g') = ${digits}`,
      sql`regexp_replace(coalesce(${table.mobile}, ''), '[^0-9]+', '', 'g') = ${digits}`,
    );
  }
  return clausole.length === 1 ? clausole[0] : or(...clausole);
}

export function leggiRecapito(contactPoint: string): { email: string | null; digits: string | null } {
  const grezzo = contactPoint.trim().toLowerCase();
  if (!grezzo) throw new Error("no contact point to erase");
  const email = grezzo.includes("@") ? grezzo : null;
  const digits = digitsForMatching(contactPoint);
  if (!email && !digits) {
    throw new Error("a contact point must be an email address or a phone number");
  }
  return { email, digits };
}

/**
 * Find the person **before** anything is changed.
 *
 * ⚠️ This is the step whose absence made the earlier version unfinishable: after the
 * contact is anonymised these ids can no longer be obtained from a contact point.
 */
// biome-ignore lint/suspicious/noExplicitAny: the tenant db handle is built per request
export async function trova(db: any, email: string | null, digits: string | null): Promise<Persona> {
  const l = await db
    .select({ id: leads.id })
    .from(leads)
    .where(perRecapito(leads, email, digits));
  const c = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(perRecapito(contacts, email, digits));
  return {
    leadIds: l.map((r: { id: string }) => r.id),
    contactIds: c.map((r: { id: string }) => r.id),
    email,
    digits,
  };
}

/**
 * Where a note about this person belongs.
 *
 * ⚠️⚠️ **The contact wins over the lead when both exist.** A converted lead keeps its old
 * row, and writing onto that one puts the note on the page nobody opens any more: the
 * assistant would record what it did, correctly, somewhere the salesperson never looks.
 *
 * ⚠️ `null` means nobody is reachable there, and the caller must refuse rather than write an
 * orphan row. A note is the only trace of what happened, and a lost trace is invisible by
 * definition.
 */
export function doveAnnotare(persona: Persona): { contactId: string | null; leadId: string | null } | null {
  const contactId = persona.contactIds[0] ?? null;
  if (contactId) return { contactId, leadId: null };
  const leadId = persona.leadIds[0] ?? null;
  return leadId ? { contactId: null, leadId } : null;
}
