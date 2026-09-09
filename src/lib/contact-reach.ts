import { eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";

import { contacts } from "@/db/schema";
import type * as tenantSchema from "@/db/schema-tenant";

type ReachDb = NeonHttpDatabase<typeof tenantSchema>;

/**
 * Who an outgoing event is about, in the only terms another system can match a person on.
 *
 * ## Why every event needs this
 *
 * Our ids mean nothing outside this database. A subscriber that hears "this quote was
 * accepted" or "this deal was won" and cannot tell **which person** it concerns has heard
 * nothing it can act on. The telephone number and the email are the two things both sides
 * already know about the same human being: nothing has to be reconciled, and no id has to
 * be shared.
 *
 * ## ⚠️⚠️ One function because there were two, and they had already diverged
 *
 * Quotes and deals each grew their own copy, and only one of them fell back to the mobile.
 * A contact reachable only on a mobile therefore travelled with a telephone number on one
 * event and without on the other — and where they also had no email, the receiver could not
 * place the person at all and silently dropped the fact. Same question, one answer.
 *
 * ## ⚠️ `phone` first, `mobile` as the fallback — and `undefined`, not `null`
 *
 * A contact filled in on the move often has only a mobile, and sending `phone: null` would
 * say "this person has no telephone" while the record plainly holds one. An absent key says
 * what is true: we have nothing to offer here.
 *
 * ## ⚠️ No contact is not an error
 *
 * A deal or a quote can exist without one, and losing the contact is `set null`. Both are
 * ordinary: the event still goes out, and a subscriber that needed the person has no work
 * to do.
 */
export interface ContactReach {
  phone?: string;
  email?: string;
}

export async function contactReach(db: ReachDb, contactId: string | null | undefined): Promise<ContactReach> {
  if (!contactId) return {};
  const [row] = await db
    .select({ phone: contacts.phone, mobile: contacts.mobile, email: contacts.email })
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .limit(1);
  if (!row) return {};
  return {
    ...(row.phone || row.mobile ? { phone: row.phone ?? row.mobile ?? undefined } : {}),
    ...(row.email ? { email: row.email } : {}),
  };
}
