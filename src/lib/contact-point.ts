import { type AnyColumn, eq, inArray, or, sql } from "drizzle-orm";

import { contacts, invoiceIssuers, leads } from "@/db/schema";
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
export interface ReachablePerson {
  leadIds: string[];
  contactIds: string[];
  email: string | null;
  digits: string | null;
}

/**
 * International dialling codes, by the ISO country a workspace invoices from. Enough for the
 * countries a workspace here is in; one not listed simply compares numbers as written.
 */
const CALLING_CODES: Record<string, string> = {
  IT: "39",
  SM: "378",
  VA: "39",
  CH: "41",
  FR: "33",
  DE: "49",
  AT: "43",
  ES: "34",
  PT: "351",
  GB: "44",
  IE: "353",
  BE: "32",
  NL: "31",
  LU: "352",
  GR: "30",
  HR: "385",
  SI: "386",
  PL: "48",
  RO: "40",
  US: "1",
  CA: "1",
};

/** Countries whose national numbers carry a trunk 0 that the international form drops. */
const TRUNK_ZERO = new Set(["44", "33", "49", "43", "41", "353", "32", "31", "385", "386", "30", "40"]);

/** The workspace's own dialling code, from the country it invoices from — Italy when unset. */
export async function workspaceCallingCode(
  // biome-ignore lint/suspicious/noExplicitAny: the tenant db handle is built per request
  db: any,
): Promise<string | null> {
  try {
    const [row] = await db
      .select({ country: invoiceIssuers.country })
      .from(invoiceIssuers)
      .where(eq(invoiceIssuers.id, "workspace"));
    return CALLING_CODES[(row?.country ?? "IT").toUpperCase()] ?? null;
  } catch {
    return CALLING_CODES.IT;
  }
}

/**
 * ⚠️⚠️ The spellings of one number (decided 27 September 2026). A number written without an
 * international prefix belongs to the workspace's country, so «+39 333 111 2223» and
 * «333 111 2223» are one person; a foreign number is matched as written, with its prefix.
 * `digits` starts with "+" when the number was written internationally (see readContactPoint):
 * only then is the prefix stripped — a national number is never cut, so a TIM mobile starting
 * 393 stays whole.
 */
export function phoneVariants(digits: string, callingCode: string | null): string[] {
  const international = digits.startsWith("+");
  const d = digits.replace(/^\+/, "");
  const out = new Set([d]);
  if (!callingCode) return [...out];
  if (international) {
    if (d.startsWith(callingCode) && d.length - callingCode.length >= 6) {
      const national = d.slice(callingCode.length);
      out.add(national);
      if (TRUNK_ZERO.has(callingCode)) out.add(`0${national}`);
    }
  } else {
    out.add(callingCode + d);
    if (TRUNK_ZERO.has(callingCode) && d.startsWith("0")) out.add(callingCode + d.slice(1));
  }
  return [...out];
}

export function matchesContactPoint(
  table: typeof leads | typeof contacts,
  email: string | null,
  digits: string | null,
  callingCode: string | null = null,
) {
  const clauses = [];
  if (email) clauses.push(sql`lower(btrim(${table.email})) = ${email}`);
  if (digits) {
    // A number typed with spaces and one typed without are the same person, and so are its
    // national and international spellings: an erasure that missed one of them would leave
    // the person in the database while telling them they are gone. "00" is "+".
    const variants = phoneVariants(digits, callingCode);
    const normal = (column: AnyColumn) =>
      sql`regexp_replace(regexp_replace(coalesce(${column}, ''), '[^0-9]+', '', 'g'), '^00', '')`;
    clauses.push(inArray(normal(table.phone), variants), inArray(normal(table.mobile), variants));
  }
  return clauses.length === 1 ? clauses[0] : or(...clauses);
}

export function readContactPoint(contactPoint: string): { email: string | null; digits: string | null } {
  const raw = contactPoint.trim().toLowerCase();
  if (!raw) throw new Error("no contact point to erase");
  const email = raw.includes("@") ? raw : null;
  // ⚠️⚠️ An address is an address: `mario.3331112223@gmail.com` holds nine digits, and read as a
  // phone number too it matched whoever has 333 111 2223 — and opted them out, or erased them.
  const found = email ? null : digitsForMatching(contactPoint);
  // "+" or "00" in front: written internationally, which decides how it is matched.
  const digits = found && /^\s*(\+|00)/.test(contactPoint) ? `+${found}` : found;
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
export async function findByContactPoint(
  // biome-ignore lint/suspicious/noExplicitAny: the tenant db handle is built per request
  db: any,
  email: string | null,
  digits: string | null,
): Promise<ReachablePerson> {
  const code = digits ? await workspaceCallingCode(db) : null;
  const l = await db
    .select({ id: leads.id })
    .from(leads)
    .where(matchesContactPoint(leads, email, digits, code));
  const c = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(matchesContactPoint(contacts, email, digits, code));
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
export function whereToNote(person: ReachablePerson): { contactId: string | null; leadId: string | null } | null {
  const contactId = person.contactIds[0] ?? null;
  if (contactId) return { contactId, leadId: null };
  const leadId = person.leadIds[0] ?? null;
  return leadId ? { contactId: null, leadId } : null;
}
