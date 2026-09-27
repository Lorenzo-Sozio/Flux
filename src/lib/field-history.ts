import { and, count, desc, eq, inArray, lt, or, type SQL } from "drizzle-orm";

import { fieldChanges } from "@/db/schema";
import type { getDb } from "@/lib/tenant-context";

/**
 * Who changed which field of a record, from what to what.
 *
 * ⚠️⚠️ A deal's amount halved, its owner changed, a contact's email replaced — none of it
 * left a trace anybody could read: the history existed only on tickets and through the
 * API. Every save of a deal, contact, company or lead now writes one row per field it
 * changed, and the record's timeline shows them (src/lib/record-timeline.ts).
 *
 * Only the fields worth a line are tracked: what a salesperson would ask "who changed
 * this?" about. A lead score recomputed on every save, a timestamp, is not one.
 */

type Db = Awaited<ReturnType<typeof getDb>>;

export type HistoryEntity = "deal" | "contact" | "company" | "lead";

export const TRACKED_FIELDS: Record<HistoryEntity, readonly string[]> = {
  deal: [
    "name",
    "amount",
    "currency",
    "stageId",
    "status",
    "probability",
    "expectedCloseDate",
    "ownerId",
    "companyId",
    "contactId",
  ],
  contact: [
    "firstName",
    "lastName",
    "email",
    "phone",
    "mobile",
    "jobTitle",
    "companyId",
    "ownerId",
    "status",
    // The history of a consent is its proof (src/lib/consent.ts).
    "marketingConsent",
  ],
  company: [
    "name",
    "type",
    "industry",
    "website",
    "mainEmail",
    "mainPhone",
    "city",
    "vatNumber",
    "ownerId",
    "priceListId",
  ],
  lead: ["firstName", "lastName", "email", "phone", "companyName", "status", "rating", "ownerId", "marketingConsent"],
};

/** Compared as numbers: "1000.00" from the database and 1000 from a form are the same amount. */
const NUMERIC = new Set(["amount", "probability"]);

/** A value as it is stored in the history: text, or null for "nothing". */
export function historyValue(field: string, value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (NUMERIC.has(field)) {
    const n = Number(value);
    return Number.isFinite(n) ? String(n) : String(value);
  }
  return String(value);
}

export interface FieldChange {
  field: string;
  oldValue: string | null;
  newValue: string | null;
}

/** The tracked fields whose value differs between two versions of a row. */
export function diffFields(
  entity: HistoryEntity,
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): FieldChange[] {
  if (!before || !after) return [];
  const out: FieldChange[] = [];
  for (const field of TRACKED_FIELDS[entity]) {
    if (!(field in after)) continue;
    const oldValue = historyValue(field, before[field]);
    const newValue = historyValue(field, after[field]);
    if (oldValue !== newValue) out.push({ field, oldValue, newValue });
  }
  return out;
}

/**
 * Writes the changes between `before` and `after`, in one statement.
 *
 * ⚠️ Never fails the save it describes: the record has already been written, and an
 * error here would tell the person their change was lost when it was not.
 */
export async function recordFieldChanges(
  db: Db,
  entity: HistoryEntity,
  entityId: string,
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  changedBy: string | null,
): Promise<void> {
  const changes = diffFields(entity, before, after);
  if (changes.length === 0) return;
  const at = new Date();
  try {
    await db
      .insert(fieldChanges)
      .values(changes.map((c) => ({ ...c, entityType: entity, entityId, changedBy, changedAt: at })));
  } catch (err) {
    console.error(`[field-history] ${entity} ${entityId} saved, its history not written:`, err);
  }
}

function scopeOf(records: { type: HistoryEntity; ids: string[] }[]): SQL | null {
  const scopes: SQL[] = records
    .filter((r) => r.ids.length > 0)
    .map((r) => and(eq(fieldChanges.entityType, r.type), inArray(fieldChanges.entityId, r.ids)) as SQL);
  return scopes.length ? (or(...scopes) as SQL) : null;
}

/** How many changes several records have, for a count that must agree with the list. */
export async function countFieldChanges(db: Db, records: { type: HistoryEntity; ids: string[] }[]): Promise<number> {
  const where = scopeOf(records);
  if (!where) return 0;
  const [row] = await db.select({ n: count() }).from(fieldChanges).where(where);
  return Number(row?.n ?? 0);
}

/** The history of several records, newest first, optionally before a moment (for paging). */
export async function readFieldChanges(
  db: Db,
  records: { type: HistoryEntity; ids: string[] }[],
  opts: { before?: Date; limit: number },
) {
  const where = scopeOf(records);
  if (!where) return [];
  return db
    .select()
    .from(fieldChanges)
    .where(and(where, opts.before ? lt(fieldChanges.changedAt, opts.before) : undefined))
    .orderBy(desc(fieldChanges.changedAt))
    .limit(opts.limit);
}
