"use server";

import { revalidatePath } from "next/cache";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { companies, contacts, leads } from "@/db/schema";

// LEADS
export async function getLeads() {
  return await db.select().from(leads);
}

export async function createLead(data: any) {
  const [newLead] = await db.insert(leads).values(data).returning();
  revalidatePath("/dashboard/leads");
  return newLead;
}

export async function updateLead(id: string, data: any) {
  const [updatedLead] = await db.update(leads).set(data).where(eq(leads.id, id)).returning();
  revalidatePath("/dashboard/leads");
  return updatedLead;
}

export async function deleteLead(id: string) {
  await db.delete(leads).where(eq(leads.id, id));
  revalidatePath("/dashboard/leads");
}

// CONTACTS
export async function getContacts() {
  return await db.select().from(contacts);
}

export async function createContact(data: any) {
  const [newContact] = await db.insert(contacts).values(data).returning();
  revalidatePath("/dashboard/contacts");
  return newContact;
}

export async function updateContact(id: string, data: any) {
  const [updatedContact] = await db.update(contacts).set(data).where(eq(contacts.id, id)).returning();
  revalidatePath("/dashboard/contacts");
  return updatedContact;
}

export async function deleteContact(id: string) {
  await db.delete(contacts).where(eq(contacts.id, id));
  revalidatePath("/dashboard/contacts");
}

// COMPANIES
export async function getCompanies() {
  return await db.select().from(companies);
}

export async function createCompany(data: any) {
  const [newCompany] = await db.insert(companies).values(data).returning();
  revalidatePath("/dashboard/companies");
  return newCompany;
}

export async function updateCompany(id: string, data: any) {
  const [updatedCompany] = await db.update(companies).set(data).where(eq(companies.id, id)).returning();
  revalidatePath("/dashboard/companies");
  return updatedCompany;
}

export async function deleteCompany(id: string) {
  await db.delete(companies).where(eq(companies.id, id));
  revalidatePath("/dashboard/companies");
}
