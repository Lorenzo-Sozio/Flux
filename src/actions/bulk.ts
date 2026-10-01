"use server";

import { revalidatePath } from "next/cache";

import { inArray } from "drizzle-orm";

import { companies, contacts, leads } from "@/db/schema";
import { requireWriteAccess } from "@/lib/auth-guard";
import { companiesWithAccounts } from "@/lib/company-accounts";
import { announceLeadsAssigned, leadsChangingOwner } from "@/lib/lead-assignment";
import { type RecordKind, recordScope, visibleIds } from "@/lib/record-visibility";
import { getDb } from "@/lib/tenant-context";

/**
 * The selected ids the person may see. A list only offers what it shows, so anything else in the
 * array was put there by hand — it is left out, not acted on.
 */
async function onlyVisible(db: Awaited<ReturnType<typeof getDb>>, kind: RecordKind, ids: string[]): Promise<string[]> {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const seen = await visibleIds(db, kind, ids, await recordScope());
  return ids.filter((id) => seen.has(id));
}

// ─── Leads ────────────────────────────────────────────────────────────────────

export async function bulkDeleteLeads(selected: string[]) {
  await requireWriteAccess();
  const db = await getDb();
  const ids = await onlyVisible(db, "lead", selected);
  if (ids.length === 0) return { deleted: 0 };
  await db.delete(leads).where(inArray(leads.id, ids));
  revalidatePath("/dashboard/leads");
  return { deleted: ids.length };
}

export async function bulkUpdateLeadStatus(selected: string[], status: string) {
  await requireWriteAccess();
  const db = await getDb();
  const ids = await onlyVisible(db, "lead", selected);
  if (ids.length === 0) return { updated: 0 };
  await db.update(leads).set({ status, updatedAt: new Date() }).where(inArray(leads.id, ids));
  revalidatePath("/dashboard/leads");
  return { updated: ids.length };
}

export async function bulkAssignLeads(selected: string[], ownerId: string) {
  const actor = await requireWriteAccess();
  const db = await getDb();
  const ids = await onlyVisible(db, "lead", selected);
  if (ids.length === 0) return { updated: 0 };
  // Counted before the write: the new owner hears how many became theirs, in one notification.
  const changing = await leadsChangingOwner(db, ids, ownerId);
  await db.update(leads).set({ ownerId, updatedAt: new Date() }).where(inArray(leads.id, ids));
  await announceLeadsAssigned(db, { ownerId, count: changing, actorId: actor.user.id });
  revalidatePath("/dashboard/leads");
  return { updated: ids.length };
}

// ─── Contacts ─────────────────────────────────────────────────────────────────

export async function bulkDeleteContacts(selected: string[]) {
  await requireWriteAccess();
  const db = await getDb();
  const ids = await onlyVisible(db, "contact", selected);
  if (ids.length === 0) return { deleted: 0 };
  await db.delete(contacts).where(inArray(contacts.id, ids));
  revalidatePath("/dashboard/contacts");
  return { deleted: ids.length };
}

export async function bulkUpdateContactStatus(selected: string[], status: string) {
  await requireWriteAccess();
  const db = await getDb();
  const ids = await onlyVisible(db, "contact", selected);
  if (ids.length === 0) return { updated: 0 };
  await db.update(contacts).set({ status, updatedAt: new Date() }).where(inArray(contacts.id, ids));
  revalidatePath("/dashboard/contacts");
  return { updated: ids.length };
}

export async function bulkAssignContacts(selected: string[], ownerId: string) {
  await requireWriteAccess();
  const db = await getDb();
  const ids = await onlyVisible(db, "contact", selected);
  if (ids.length === 0) return { updated: 0 };
  await db.update(contacts).set({ ownerId, updatedAt: new Date() }).where(inArray(contacts.id, ids));
  revalidatePath("/dashboard/contacts");
  return { updated: ids.length };
}

// ─── Companies ────────────────────────────────────────────────────────────────

export async function bulkDeleteCompanies(selected: string[]) {
  await requireWriteAccess();
  const db = await getDb();
  const ids = await onlyVisible(db, "company", selected);
  if (ids.length === 0) return { deleted: 0, kept: 0 };
  // Customers with invoices or payments are kept: merged, never deleted (src/lib/company-accounts.ts).
  const kept = await companiesWithAccounts(db, ids);
  const deletable = ids.filter((id) => !kept.has(id));
  if (deletable.length > 0) await db.delete(companies).where(inArray(companies.id, deletable));
  revalidatePath("/dashboard/companies");
  return { deleted: deletable.length, kept: kept.size };
}

export async function bulkUpdateCompanyStatus(selected: string[], status: string) {
  await requireWriteAccess();
  const db = await getDb();
  const ids = await onlyVisible(db, "company", selected);
  if (ids.length === 0) return { updated: 0 };
  await db.update(companies).set({ status, updatedAt: new Date() }).where(inArray(companies.id, ids));
  revalidatePath("/dashboard/companies");
  return { updated: ids.length };
}

export async function bulkAssignCompanies(selected: string[], ownerId: string) {
  await requireWriteAccess();
  const db = await getDb();
  const ids = await onlyVisible(db, "company", selected);
  if (ids.length === 0) return { updated: 0 };
  await db.update(companies).set({ ownerId, updatedAt: new Date() }).where(inArray(companies.id, ids));
  revalidatePath("/dashboard/companies");
  return { updated: ids.length };
}
