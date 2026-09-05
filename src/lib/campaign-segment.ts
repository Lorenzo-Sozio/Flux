import { and, eq, inArray } from "drizzle-orm";

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
): Promise<string[] | null> {
  if (!filterId) return null;

  const db = await getDb();
  const entityType = recipientType === "contacts" ? "contact" : "lead";

  const [saved] = await db.select().from(customFilters).where(eq(customFilters.id, filterId)).limit(1);
  // A filter that has been deleted, or that belongs to the other entity, is not
  // an instruction to send to everyone.
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

/** The saved filters that can be used as a segment, per entity. */
export async function listSegments(): Promise<{ id: string; name: string; entityType: string }[]> {
  const db = await getDb();
  const rows = await db
    .select({ id: customFilters.id, name: customFilters.name, entityType: customFilters.entityType })
    .from(customFilters)
    .where(inArray(customFilters.entityType, ["contacts", "leads"]))
    .orderBy(customFilters.name);
  return rows;
}
