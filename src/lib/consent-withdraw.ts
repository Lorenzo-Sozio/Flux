import { and, eq } from "drizzle-orm";

import { contacts, leads } from "@/db/schema";
import { type ConsentSource, consentWithdrawn } from "@/lib/consent";
import { recordFieldChanges } from "@/lib/field-history";

// biome-ignore lint/suspicious/noExplicitAny: Drizzle's database types differ per driver
type AnyDb = any;

/**
 * Withdraws a lead's or a contact's marketing consent from outside the dashboard — an
 * unsubscribe link, the opt-out API — dated today, sourced, and written in the record's
 * history with nobody as its author: the person did it themselves.
 *
 * ⚠️ Only a consent still given is withdrawn. Writing `false` over `false` would move the
 * date of a decision that was taken earlier, and add a line to the history that says a
 * change happened when it did not. Returns whether it changed anything.
 */
export async function withdrawConsent(
  db: AnyDb,
  entity: "lead" | "contact",
  id: string,
  source: ConsentSource,
  now: Date = new Date(),
): Promise<boolean> {
  const table = entity === "lead" ? leads : contacts;
  const changed: { id: string }[] = await db
    .update(table)
    .set({ ...consentWithdrawn(source, now), updatedAt: now })
    .where(and(eq(table.id, id), eq(table.marketingConsent, true)))
    .returning({ id: table.id });
  if (changed.length === 0) return false;
  await recordFieldChanges(db, entity, id, { marketingConsent: true }, { marketingConsent: false }, null);
  return true;
}
