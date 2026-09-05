import { and, eq, inArray, or } from "drizzle-orm";

import { contacts, customFieldDefinitions, customFilters, leads } from "@/db/schema";
import { buildWhereClause, CONTACT_FIELDS, customFieldsToRegistry, LEAD_FIELDS } from "@/lib/filter-engine";
import type { FilterTree } from "@/lib/filter-types";
import { getDb } from "@/lib/tenant-context";

/**
 * campaign-segment.ts — who a campaign actually goes to.
 *
 * A campaign could be sent to every contact with marketing consent, or to every
 * lead, and to nothing else. The saved filters that the lists are built on —
 * "customers in Lombardy", "leads scoring over sixty" — existed and could not be
 * pointed at the one place where sending to the wrong people costs something.
 * Mass-mailing the whole database is the single thing a marketing module should
 * make hard, and it was the only thing it made easy.
 *
 * The segment is a saved filter, compiled by the same engine the lists compile
 * it with, so a segment cannot mean one thing on the contacts screen and another
 * in an email. Nothing new to learn, and nothing to keep in step by hand.
 */

export type RecipientType = "contacts" | "leads";

/**
 * The ids a segment resolves to, or null for "everyone eligible".
 *
 * Null and an empty array are different answers and the caller must not confuse
 * them: null means no segment was chosen, an empty array means one was and it
 * matches nobody. Sending to everybody because a segment came back empty is the
 * accident this distinction exists to prevent.
 */
export async function resolveSegmentIds(
  recipientType: RecipientType,
  filterId: string | null | undefined,
  /**
   * ⚠️ Who is asking, and it is not optional to decide.
   *
   * A user id scopes the filter to one they may use — their own, or one shared
   * with the workspace — because the id arrives from a browser and passing a
   * colleague's aims a campaign at a segment they defined and never shared, with
   * the recipient count handing back its size.
   *
   * `null` is the scheduler, which has no session and is resolving a filter id
   * that was checked when the campaign was scheduled and stored on the row.
   * Required rather than defaulted, so every call site has to say which it is.
   */
  actorId: string | null,
): Promise<string[] | null> {
  if (!filterId) return null;

  const db = await getDb();
  const entityType = recipientType === "contacts" ? "contact" : "lead";

  const [saved] = await db
    .select()
    .from(customFilters)
    .where(
      actorId
        ? and(eq(customFilters.id, filterId), or(eq(customFilters.ownerId, actorId), eq(customFilters.isPublic, true)))
        : eq(customFilters.id, filterId),
    )
    .limit(1);
  // A filter that has been deleted, that belongs to somebody else, or that
  // belongs to the other entity, is not an instruction to send to everyone.
  if (!saved || saved.entityType !== `${entityType}s`) return [];

  let tree: FilterTree;
  try {
    tree = JSON.parse(saved.criteria) as FilterTree;
  } catch {
    return [];
  }

  const defs = await db.select().from(customFieldDefinitions).where(eq(customFieldDefinitions.entityType, entityType));

  const base = recipientType === "contacts" ? CONTACT_FIELDS : LEAD_FIELDS;
  const registry = { ...base, ...customFieldsToRegistry(defs) };
  const idCol = recipientType === "contacts" ? contacts.id : leads.id;
  const clause = buildWhereClause(tree, registry as never, idCol);

  // A filter whose conditions all fell away compiles to nothing, which as a WHERE
  // means "everybody" — the opposite of what a segment is for.
  if (!clause) return [];

  if (recipientType === "contacts") {
    const rows = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.marketingConsent, true), clause));
    return rows.map((r) => r.id);
  }

  const rows = await db
    .select({ id: leads.id })
    .from(leads)
    .where(and(eq(leads.marketingConsent, true), eq(leads.isConverted, false), clause));
  return rows.map((r) => r.id);
}

/**
 * Whether this person may aim a campaign at this filter.
 *
 * Asked before a segment is written onto a campaign, because from then on the
 * scheduler resolves it with nobody's authority: what is stored has to have been
 * checked when it was stored. Distinguishing "not yours" from "matches nobody"
 * is the whole point — the second is a legitimate segment, the first is not.
 */
export async function canUseSegment(recipientType: RecipientType, filterId: string, actorId: string): Promise<boolean> {
  const db = await getDb();
  const entityType = recipientType === "contacts" ? "contacts" : "leads";
  const [saved] = await db
    .select({ id: customFilters.id })
    .from(customFilters)
    .where(
      and(
        eq(customFilters.id, filterId),
        eq(customFilters.entityType, entityType),
        or(eq(customFilters.ownerId, actorId), eq(customFilters.isPublic, true)),
      ),
    )
    .limit(1);
  return Boolean(saved);
}

/**
 * The saved filters this person may aim a campaign at.
 *
 * Their own and the ones shared with the workspace. A saved view is private
 * unless its owner said otherwise, and its **name** is already a statement about
 * the customers in it — "churn risk", "unpaid over 90 days" — so listing
 * everybody's would leak the shape of somebody else's thinking before a single
 * email is sent.
 */
export async function listSegments(actorId: string): Promise<{ id: string; name: string; entityType: string }[]> {
  const db = await getDb();
  return db
    .select({ id: customFilters.id, name: customFilters.name, entityType: customFilters.entityType })
    .from(customFilters)
    .where(
      and(
        inArray(customFilters.entityType, ["contacts", "leads"]),
        or(eq(customFilters.ownerId, actorId), eq(customFilters.isPublic, true)),
      ),
    )
    .orderBy(customFilters.name);
}
