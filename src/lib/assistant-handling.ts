/**
 * «Seguito dall'assistente»: a person an AI assistant is working with (V3.1 F3, decision D-A).
 *
 * ⚠️⚠️ **Two systems writing to one person is one too many.** The assistant (VoipAI) sends
 * its own quote follow-ups and nurturing, with its own consent and hours; Flux has its own
 * sequences and campaigns. Nothing stopped both from writing to the same lead in the same
 * week. The assistant now marks whom it is working with, and Flux's automatic mail leaves
 * them alone — a sequence will not enroll them and stops if they become marked, a campaign
 * skips them — and says why.
 *
 * On the **person**, not the record: every lead and contact at that address is marked, like
 * an opt-out. Marked with the name of the key that asked, so the screen can say by whom.
 */
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";

import { contacts, leads } from "@/db/schema";

// biome-ignore lint/suspicious/noExplicitAny: Drizzle's database types differ per driver
type AnyDb = any;

/** The condition every automatic audience adds: not being worked by the assistant. */
export const notWithAssistant = {
  leads: isNull(leads.assistantSince),
  contacts: isNull(contacts.assistantSince),
};

/**
 * Marks (or clears) every record of a person. Returns the ids it changed.
 *
 * ⚠️⚠️ **A mark belongs to the key that set it** (decided 27 September 2026). `keyId` is the
 * caller's key; only rows unmarked, marked by that key, or marked before keys were remembered
 * are touched. Another integration clearing the mark put the person back into every campaign
 * and sequence while the assistant was still talking to them. `null` is an administrator,
 * who may touch any mark. Marking again keeps `assistantSince`: the day the assistant took
 * them, not the day it last said so.
 */
export async function markWithAssistant(
  db: AnyDb,
  person: { leadIds: string[]; contactIds: string[] },
  handling: boolean,
  name: string | null,
  now: Date = new Date(),
  keyId: string | null = null,
): Promise<string[]> {
  const update = async (table: typeof leads | typeof contacts, ids: string[]) => {
    if (ids.length === 0) return [];
    const mine = keyId === null ? undefined : or(isNull(table.assistantKeyId), eq(table.assistantKeyId, keyId));
    const values = handling
      ? {
          assistantSince: sql`coalesce(${table.assistantSince}, ${now.toISOString()}::timestamp)`,
          assistantName: name,
          assistantKeyId: keyId,
          updatedAt: now,
        }
      : { assistantSince: null, assistantName: null, assistantKeyId: null, updatedAt: now };
    return db
      .update(table)
      .set(values)
      .where(and(inArray(table.id, ids), mine))
      .returning({ id: table.id });
  };
  const [l, c] = await Promise.all([update(leads, person.leadIds), update(contacts, person.contactIds)]);
  return [...l, ...c].map((r: { id: string }) => r.id);
}
