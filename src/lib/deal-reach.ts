import { eq } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";

import { contacts } from "@/db/schema";
import type * as tenantSchema from "@/db/schema-tenant";

type TenantDb = NeonHttpDatabase<typeof tenantSchema>;

/**
 * Who a deal is about, in the only terms another system can match a person on.
 *
 * ## Why this exists
 *
 * `deal.won` and `deal.lost` carried an id, a name and an amount: everything except the one
 * field that says **whose** deal it was. Our own ids mean nothing outside this database, so
 * a subscriber that hears "this deal was won" and cannot tell which person it concerns has
 * heard nothing it can act on.
 *
 * The phone number and the email are the two things both sides already know about the same
 * human being. Nothing has to be reconciled, and no id has to be shared.
 *
 * ## ⚠️ It is a lookup, not a join on the event
 *
 * A deal's contact can be detached (`onDelete: "set null"`), and a deal can be created
 * without one. Both are ordinary, so the absence of a contact is an empty object and never
 * an error: the event still goes out, and a subscriber that needed the person simply has no
 * work to do.
 *
 * ## ⚠️⚠️ `phone` first, `mobile` as the fallback — and both, never neither
 *
 * A contact filled in on the move often has only a mobile. Sending `phone: null` in that
 * case would have been a payload that says "this person has no telephone" while the record
 * plainly holds one, and the receiver has no way to tell the difference.
 */
export interface DealReach {
  contact?: { id: string; phone: string | null; email: string | null };
}

export async function dealReach(db: TenantDb, contactId: string | null | undefined): Promise<DealReach> {
  if (!contactId) return {};
  const [row] = await db
    .select({ id: contacts.id, phone: contacts.phone, mobile: contacts.mobile, email: contacts.email })
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .limit(1);
  if (!row) return {};
  return { contact: { id: row.id, phone: row.phone ?? row.mobile ?? null, email: row.email ?? null } };
}
