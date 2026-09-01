/**
 * Erasing a person, starting from a contact point (GDPR art. 17).
 *
 * A person is not a row here: they are a `lead`, or a `contact`, or both, plus whatever
 * points at them. So erasure starts from the only thing the person themselves can give —
 * an email address or a phone number — and never from an internal id.
 *
 * ## ⚠️⚠️ What the schema already decided, and it is not an opinion
 *
 * Foreign keys from `activity`, `task` and `campaign_log` **cascade**: deleting the person
 * takes their words with them, which is what art. 17 asks for.
 *
 * Foreign keys from `deal`, `quote`, `order`, `opportunity`, `ticket` and `appointment`
 * **do not**. A straight `DELETE` of a contact who has any of those fails with a foreign
 * key violation — measured, not assumed. So a person with commercial history cannot simply
 * be deleted, and the two honest ways out are opposites:
 *
 * * delete the commercial records too — which destroys the business's own accounts, and
 *   may not even be lawful where invoicing rules require retention;
 * * **anonymise the person and keep the record** — the deal survives without the human.
 *
 * This module does the second, because the first is irreversible and takes a decision that
 * belongs to the business, not to the code. What it did and what it left is **reported**,
 * not assumed, so that whoever answers the person can answer truthfully.
 *
 * ## ⚠️ What must survive erasure, and why removing it would be the real harm
 *
 * `email_suppression` is the record that says «never write to this address again». Erasing
 * it would let the next campaign reach the person who asked to be forgotten. An opt-out is
 * not personal data held *about* someone — it is the protection they are owed, and it is
 * kept on purpose.
 */
import { eq, or, sql } from "drizzle-orm";

import { contacts, leads } from "@/db/schema";

import { digitsForMatching } from "./api-import-validators";

export interface ErasureReport {
  /** Rows removed outright, by table. */
  deleted: Record<string, number>;
  /** Rows kept, with the person's identity removed from them. */
  anonymised: Record<string, number>;
  /** Rows deliberately untouched, and why. Whoever answers the person reads this. */
  kept: Record<string, string>;
}

/** What replaces a name once the person behind it must no longer be identifiable. */
export const ANONIMO = "[cancellato]";

/**
 * The fields of a person, as opposed to the fields of a business relationship.
 *
 * ⚠️ `firstName` and `lastName` are NOT NULL, so they are overwritten rather than emptied.
 * Everything else becomes null: a blank string would still be a value someone could filter
 * on, and would read in the interface as «we know this and it is empty».
 */
const CAMPI_DELLA_PERSONA = {
  firstName: ANONIMO,
  lastName: "",
  email: null,
  phone: null,
  mobile: null,
  linkedinUrl: null,
  street: null,
  city: null,
  zipCode: null,
  notes: null,
  tags: null,
} as const;

function condizione(table: typeof leads | typeof contacts, email: string | null, digits: string | null) {
  const clausole = [];
  if (email) clausole.push(eq(sql`lower(btrim(${table.email}))`, email));
  if (digits) {
    // The same expression as the deduplication: a number typed with spaces and a number
    // typed without are the same person, and an erasure that missed one of the two
    // spellings would leave the person in the database while telling them they are gone.
    clausole.push(
      or(
        eq(sql`regexp_replace(coalesce(${table.phone}, ''), '[^0-9]+', '', 'g')`, digits),
        eq(sql`regexp_replace(coalesce(${table.mobile}, ''), '[^0-9]+', '', 'g')`, digits),
      ),
    );
  }
  return clausole.length === 1 ? clausole[0] : or(...clausole);
}

/**
 * Erase the person reachable at this contact point.
 *
 * Idempotent: running it twice is lawful and the second run finds nothing. A person has no
 * way of knowing whether the first request went through, so repeating it is normal.
 */
export async function eraseByContactPoint(
  // biome-ignore lint/suspicious/noExplicitAny: the tenant db handle is built per request
  db: any,
  contactPoint: string,
): Promise<ErasureReport> {
  const grezzo = contactPoint.trim().toLowerCase();
  if (!grezzo) throw new Error("no contact point to erase");
  const email = grezzo.includes("@") ? grezzo : null;
  const digits = digitsForMatching(contactPoint);
  if (!email && !digits) {
    throw new Error("a contact point must be an email address or a phone number");
  }

  const report: ErasureReport = { deleted: {}, anonymised: {}, kept: {} };

  // A lead has no commercial record hanging off it that the business must keep: everything
  // that points at a lead cascades. It goes.
  const leadsTolti = await db
    .delete(leads)
    .where(condizione(leads, email, digits))
    .returning({ id: leads.id });
  report.deleted.lead = leadsTolti.length;

  // A contact may carry deals, quotes, orders, tickets and appointments. Those are the
  // business's own records; the person inside them is not.
  const contattiTrovati = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(condizione(contacts, email, digits));

  if (contattiTrovati.length > 0) {
    const anonimizzati = await db
      .update(contacts)
      .set({ ...CAMPI_DELLA_PERSONA, updatedAt: new Date() })
      .where(condizione(contacts, email, digits))
      .returning({ id: contacts.id });
    report.anonymised.contact = anonimizzati.length;
  } else {
    report.anonymised.contact = 0;
  }

  report.kept.email_suppression =
    "kept on purpose: it is the record that stops this address being written to again. " +
    "Erasing it would let the next campaign reach the person who asked to be forgotten.";

  return report;
}

/**
 * How many rows are still reachable from this contact point. Zero after an erasure.
 *
 * ⚠️ It uses the **same predicates** as the erasure: a preview built from different
 * conditions can describe an operation that will not happen.
 */
export async function countByContactPoint(
  // biome-ignore lint/suspicious/noExplicitAny: the tenant db handle is built per request
  db: any,
  contactPoint: string,
): Promise<{ lead: number; contact: number }> {
  const grezzo = contactPoint.trim().toLowerCase();
  const email = grezzo.includes("@") ? grezzo : null;
  const digits = digitsForMatching(contactPoint);
  if (!email && !digits) return { lead: 0, contact: 0 };

  const [l] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(leads)
    .where(condizione(leads, email, digits));
  const [c] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(contacts)
    .where(condizione(contacts, email, digits));
  return { lead: l?.n ?? 0, contact: c?.n ?? 0 };
}
