"use server";

import { revalidatePath } from "next/cache";

import { eq, inArray, sql } from "drizzle-orm";

import { companies, contacts, deals, leads, orders, recordSources } from "@/db/schema";
import { requireCapability } from "@/lib/auth-guard";
import { BUILT_IN_SOURCES, keyForName, type RecordSource, SYSTEM_SOURCES } from "@/lib/record-sources";
import { tolerateUnmigrated } from "@/lib/schema-ready";
import { getDb } from "@/lib/tenant-context";

/** Before migration 0073 the list is the built-in one, read-only. */
const FALLBACK: RecordSource[] = BUILT_IN_SOURCES.map((key, i) => ({ key, name: null, order: i + 1, isActive: true }));

/** The workspace's sources, retired ones included: a form shows a record's retired source as it is. */
export async function getRecordSources(): Promise<RecordSource[]> {
  await requireCapability("record:read");
  const db = await getDb();
  return tolerateUnmigrated(
    "record sources (0073)",
    () =>
      db
        .select({
          key: recordSources.key,
          name: recordSources.name,
          order: recordSources.order,
          isActive: recordSources.isActive,
        })
        .from(recordSources)
        .orderBy(recordSources.order, recordSources.key),
    FALLBACK,
  );
}

export interface SourceUsage {
  value: string;
  /** Leads, contacts, companies, deals and orders carrying it. */
  records: number;
}

/**
 * How many records carry each value, listed or not. A value nobody listed — typed by hand
 * before the list existed, or sent by an integration — is what Settings offers to add to the
 * list or to merge into a source that is.
 */
export async function getSourceUsage(): Promise<SourceUsage[]> {
  await requireCapability("settings:manage");
  const db = await getDb();
  const rows = (
    await db.execute(sql`
      select source as value, count(*)::int as records from (
        select source from "lead" union all
        select source from "contact" union all
        select source from "company" union all
        select source from "deal" union all
        select source from "order"
      ) s
      where source is not null and source <> ''
      group by source
      order by count(*) desc`)
  ).rows as { value: string; records: number }[];
  return rows.map((r) => ({ value: r.value, records: Number(r.records) }));
}

export type SourceWriteResult = { ok: true; key: string } | { ok: false; reason: "empty" | "taken" | "same" };

async function takenKeys(db: Awaited<ReturnType<typeof getDb>>): Promise<Set<string>> {
  const rows = await db.select({ key: recordSources.key }).from(recordSources);
  return new Set([...rows.map((r) => r.key), ...SYSTEM_SOURCES]);
}

/** Whether another source already reads as `name`, whatever its capitals. */
async function nameTaken(db: Awaited<ReturnType<typeof getDb>>, name: string, except?: string) {
  const [row] = await db
    .select({ key: recordSources.key })
    .from(recordSources)
    .where(
      sql`(lower(${recordSources.name}) = ${name.toLowerCase()} or ${recordSources.key} = ${name.toLowerCase()}) ${
        except ? sql`and ${recordSources.key} <> ${except}` : sql``
      }`,
    )
    .limit(1);
  return !!row;
}

function revalidateSources() {
  revalidatePath("/dashboard/settings/lists");
  revalidatePath("/dashboard/leads");
  revalidatePath("/dashboard/contacts");
  revalidatePath("/dashboard/companies");
}

/** A new source at the end of the list. */
export async function createRecordSourceAction(name: string): Promise<SourceWriteResult> {
  await requireCapability("settings:manage");
  const clean = name.trim();
  if (!clean) return { ok: false, reason: "empty" };
  const db = await getDb();
  if (await nameTaken(db, clean)) return { ok: false, reason: "taken" };
  const key = keyForName(clean, await takenKeys(db));
  const [{ last }] = (await db.execute(sql`select coalesce(max("order"), 0)::int as last from "record_source"`))
    .rows as { last: number }[];
  await db.insert(recordSources).values({ key, name: clean, order: Number(last) + 1 });
  revalidateSources();
  return { ok: true, key };
}

/**
 * A value already on records, put on the list as it is written: nothing moves, and from now
 * on the forms offer it.
 */
export async function listSourceValueAction(value: string): Promise<SourceWriteResult> {
  await requireCapability("settings:manage");
  const clean = value.trim();
  if (!clean) return { ok: false, reason: "empty" };
  const db = await getDb();
  if ((await takenKeys(db)).has(clean)) return { ok: false, reason: "taken" };
  const [{ last }] = (await db.execute(sql`select coalesce(max("order"), 0)::int as last from "record_source"`))
    .rows as { last: number }[];
  await db.insert(recordSources).values({ key: clean, name: clean, order: Number(last) + 1 });
  revalidateSources();
  return { ok: true, key: clean };
}

/** A new name for a source. Its key, and so every record carrying it, stays as it is. */
export async function renameRecordSourceAction(key: string, name: string): Promise<SourceWriteResult> {
  await requireCapability("settings:manage");
  const clean = name.trim();
  if (!clean) return { ok: false, reason: "empty" };
  const db = await getDb();
  if (await nameTaken(db, clean, key)) return { ok: false, reason: "taken" };
  await db.update(recordSources).set({ name: clean }).where(eq(recordSources.key, key));
  revalidateSources();
  return { ok: true, key };
}

/**
 * Retired, not deleted: the forms stop offering it, and the records filed under it keep
 * saying so — a report of last year's leads must not lose a column because the campaign ended.
 */
export async function setRecordSourceActiveAction(key: string, isActive: boolean): Promise<void> {
  await requireCapability("settings:manage");
  const db = await getDb();
  await db.update(recordSources).set({ isActive }).where(eq(recordSources.key, key));
  revalidateSources();
}

/** New positions for the list, as the settings page shows it. */
export async function reorderRecordSourcesAction(keys: string[]): Promise<void> {
  await requireCapability("settings:manage");
  const db = await getDb();
  const known = new Set(
    (await db.select({ key: recordSources.key }).from(recordSources).where(inArray(recordSources.key, keys))).map(
      (r) => r.key,
    ),
  );
  const writes = keys
    .filter((k) => known.has(k))
    .map((key, i) =>
      db
        .update(recordSources)
        .set({ order: i + 1 })
        .where(eq(recordSources.key, key)),
    );
  if (writes.length) await db.batch(writes as unknown as Parameters<typeof db.batch>[0]);
  revalidateSources();
}

/**
 * Every record carrying `from` is filed under `intoKey`, and `from` leaves the list. This is
 * how "Facebook", "facebook" and "FB", typed by three people, become one row in a report.
 *
 * ⚠️ One transaction: half the tables moved and half not is a report that disagrees with itself.
 */
export async function mergeRecordSourceAction(from: string, intoKey: string): Promise<SourceWriteResult> {
  await requireCapability("settings:manage");
  if (from === intoKey) return { ok: false, reason: "same" };
  const db = await getDb();
  const [into] = await db.select({ key: recordSources.key }).from(recordSources).where(eq(recordSources.key, intoKey));
  if (!into) return { ok: false, reason: "empty" };
  await db.batch([
    db.update(leads).set({ source: intoKey }).where(eq(leads.source, from)),
    db.update(contacts).set({ source: intoKey }).where(eq(contacts.source, from)),
    db.update(companies).set({ source: intoKey }).where(eq(companies.source, from)),
    db.update(deals).set({ source: intoKey }).where(eq(deals.source, from)),
    db.update(orders).set({ source: intoKey }).where(eq(orders.source, from)),
    db.delete(recordSources).where(eq(recordSources.key, from)),
  ]);
  revalidateSources();
  return { ok: true, key: intoKey };
}
