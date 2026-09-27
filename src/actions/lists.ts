"use server";

import { revalidatePath } from "next/cache";

import { count, eq, sql } from "drizzle-orm";

import { companies, companyCategories, companyTypes } from "@/db/schema";
import { requireCapability } from "@/lib/auth-guard";
import { getDb } from "@/lib/tenant-context";

/**
 * The workspace's own lists — company categories and company types — managed in one place.
 *
 * ⚠️ Both were created on the fly from the company form and managed nowhere, so "Prospect"
 * and "prospect" sat side by side, each with half the companies, and every report grouped
 * by them told two stories. Here they can be renamed, merged into one another, and removed.
 */

export type ListKind = "category" | "type";

const TABLE = { category: companyCategories, type: companyTypes } as const;
const COLUMN = { category: companies.companyCategoryId, type: companies.companyTypeId } as const;

export interface ListEntry {
  id: string;
  name: string;
  companies: number;
}

export async function getCompanyLists(): Promise<Record<ListKind, ListEntry[]>> {
  await requireCapability("settings:manage");
  const db = await getDb();
  const read = async (kind: ListKind) => {
    const table = TABLE[kind];
    const column = COLUMN[kind];
    const rows = await db
      .select({ id: table.id, name: table.name, companies: count(companies.id) })
      .from(table)
      .leftJoin(companies, eq(column, table.id))
      .groupBy(table.id, table.name)
      .orderBy(table.name);
    return rows.map((r) => ({ ...r, companies: Number(r.companies) }));
  };
  const [category, type] = await Promise.all([read("category"), read("type")]);
  return { category, type };
}

export type ListWriteResult = { ok: true } | { ok: false; reason: "empty" | "taken" | "same" };

export async function renameListEntryAction(kind: ListKind, id: string, name: string): Promise<ListWriteResult> {
  await requireCapability("settings:manage");
  const clean = name.trim();
  if (!clean) return { ok: false, reason: "empty" };
  const db = await getDb();
  const table = TABLE[kind];
  // Another entry with this name, whatever its capitals, is a merge, not a rename.
  const [other] = await db
    .select({ id: table.id })
    .from(table)
    .where(sql`lower(${table.name}) = ${clean.toLowerCase()} and ${table.id} <> ${id}`)
    .limit(1);
  if (other) return { ok: false, reason: "taken" };
  await db.update(table).set({ name: clean }).where(eq(table.id, id));
  revalidatePath("/dashboard/settings/lists");
  revalidatePath("/dashboard/companies");
  return { ok: true };
}

/** Every company in `fromId` moves to `intoId`, and `fromId` goes. */
export async function mergeListEntryAction(kind: ListKind, fromId: string, intoId: string): Promise<ListWriteResult> {
  await requireCapability("settings:manage");
  if (fromId === intoId) return { ok: false, reason: "same" };
  const db = await getDb();
  const table = TABLE[kind];
  const column = COLUMN[kind];
  // One transaction: companies left pointing at nothing, or two entries still standing,
  // would both be a half-done merge.
  await db.batch([
    db
      .update(companies)
      .set(kind === "category" ? { companyCategoryId: intoId } : { companyTypeId: intoId })
      .where(eq(column, fromId)),
    db.delete(table).where(eq(table.id, fromId)),
  ]);
  revalidatePath("/dashboard/settings/lists");
  revalidatePath("/dashboard/companies");
  return { ok: true };
}

/** Removes an entry; its companies are left without one (the foreign key sets null). */
export async function deleteListEntryAction(kind: ListKind, id: string): Promise<void> {
  await requireCapability("settings:manage");
  const db = await getDb();
  await db.delete(TABLE[kind]).where(eq(TABLE[kind].id, id));
  revalidatePath("/dashboard/settings/lists");
  revalidatePath("/dashboard/companies");
}
