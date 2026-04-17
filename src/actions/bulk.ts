"use server";

import { inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { companies, contacts, leads } from "@/db/schema";
import { requireWriteAccess } from "@/lib/auth-guard";

// ─── Leads ────────────────────────────────────────────────────────────────────

export async function bulkDeleteLeads(ids: string[]) {
  await requireWriteAccess();
  if (ids.length === 0) return { deleted: 0 };
  await db.delete(leads).where(inArray(leads.id, ids));
  revalidatePath("/dashboard/leads");
  return { deleted: ids.length };
}

export async function bulkUpdateLeadStatus(ids: string[], status: string) {
  await requireWriteAccess();
  if (ids.length === 0) return { updated: 0 };
  await db.update(leads).set({ status, updatedAt: new Date() }).where(inArray(leads.id, ids));
  revalidatePath("/dashboard/leads");
  return { updated: ids.length };
}

export async function bulkAssignLeads(ids: string[], ownerId: string) {
  await requireWriteAccess();
  if (ids.length === 0) return { updated: 0 };
  await db.update(leads).set({ ownerId, updatedAt: new Date() }).where(inArray(leads.id, ids));
  revalidatePath("/dashboard/leads");
  return { updated: ids.length };
}

// ─── Contacts ─────────────────────────────────────────────────────────────────

export async function bulkDeleteContacts(ids: string[]) {
  await requireWriteAccess();
  if (ids.length === 0) return { deleted: 0 };
  await db.delete(contacts).where(inArray(contacts.id, ids));
  revalidatePath("/dashboard/contacts");
  return { deleted: ids.length };
}

export async function bulkUpdateContactStatus(ids: string[], status: string) {
  await requireWriteAccess();
  if (ids.length === 0) return { updated: 0 };
  await db.update(contacts).set({ status, updatedAt: new Date() }).where(inArray(contacts.id, ids));
  revalidatePath("/dashboard/contacts");
  return { updated: ids.length };
}

export async function bulkAssignContacts(ids: string[], ownerId: string) {
  await requireWriteAccess();
  if (ids.length === 0) return { updated: 0 };
  await db.update(contacts).set({ ownerId, updatedAt: new Date() }).where(inArray(contacts.id, ids));
  revalidatePath("/dashboard/contacts");
  return { updated: ids.length };
}

// ─── Companies ────────────────────────────────────────────────────────────────

export async function bulkDeleteCompanies(ids: string[]) {
  await requireWriteAccess();
  if (ids.length === 0) return { deleted: 0 };
  await db.delete(companies).where(inArray(companies.id, ids));
  revalidatePath("/dashboard/companies");
  return { deleted: ids.length };
}

export async function bulkUpdateCompanyStatus(ids: string[], status: string) {
  await requireWriteAccess();
  if (ids.length === 0) return { updated: 0 };
  await db.update(companies).set({ status, updatedAt: new Date() }).where(inArray(companies.id, ids));
  revalidatePath("/dashboard/companies");
  return { updated: ids.length };
}

export async function bulkAssignCompanies(ids: string[], ownerId: string) {
  await requireWriteAccess();
  if (ids.length === 0) return { updated: 0 };
  await db.update(companies).set({ ownerId, updatedAt: new Date() }).where(inArray(companies.id, ids));
  revalidatePath("/dashboard/companies");
  return { updated: ids.length };
}
