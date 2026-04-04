"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { companies, contacts, deals, leads, pipelineStages, users } from "@/db/schema";
import { dispatchWebhook } from "@/actions/webhooks";
import { buildWhereClause, LEAD_FIELDS, CONTACT_FIELDS } from "@/lib/filter-engine";
import { decodeFilter } from "@/lib/filter-types";
import type { FilterTree } from "@/lib/filter-types";

// LEADS
export async function getLeads(encodedFilter?: string | null) {
  const tree = encodedFilter ? decodeFilter(encodedFilter) : null;
  const where = tree ? buildWhereClause(tree, LEAD_FIELDS) : undefined;
  return db.select().from(leads).where(where).orderBy(desc(leads.createdAt));
}

// CONTACTS
export async function getContacts(encodedFilter?: string | null) {
  const tree = encodedFilter ? decodeFilter(encodedFilter) : null;
  const where = tree ? buildWhereClause(tree, CONTACT_FIELDS) : undefined;
  return db.select().from(contacts).where(where).orderBy(desc(contacts.createdAt));
}

export async function createLead(data: any) {
  const payload = {
    ...data,
    marketingConsent: data.marketingConsent ?? false,
    consentDate: data.marketingConsent && !data.consentDate ? new Date() : data.consentDate,
    tags: Array.isArray(data.tags) ? data.tags : typeof data.tags === 'string' ? data.tags.split(',').map((t: string) => t.trim()).filter(Boolean) : null,
  };
  const [newLead] = await db.insert(leads).values(payload).returning();
  revalidatePath("/dashboard/leads");
  dispatchWebhook("lead.created", { id: newLead.id, email: newLead.email, firstName: newLead.firstName, lastName: newLead.lastName }).catch(() => {});
  return newLead;
}

export async function updateLead(id: string, data: any) {
  const payload = {
    ...data,
    marketingConsent: data.marketingConsent ?? false,
    consentDate: data.marketingConsent && !data.consentDate ? new Date() : data.consentDate,
    tags: Array.isArray(data.tags) ? data.tags : typeof data.tags === 'string' ? data.tags.split(',').map((t: string) => t.trim()).filter(Boolean) : null,
  };
  const [updatedLead] = await db.update(leads).set(payload).where(eq(leads.id, id)).returning();
  revalidatePath("/dashboard/leads");
  return updatedLead;
}

export async function deleteLead(id: string) {
  await db.delete(leads).where(eq(leads.id, id));
  revalidatePath("/dashboard/leads");
}

export async function convertLead(leadId: string, shouldCreateDeal: boolean) {
  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId));
  if (!lead) throw new Error("Lead not found");

  // 1. Create or find Company
  let companyId: string | undefined;
  if (lead.companyName) {
    const [existingCompany] = await db.select().from(companies).where(eq(companies.name, lead.companyName));
    if (existingCompany) {
      companyId = existingCompany.id;
    } else {
      const [newCompany] = await db.insert(companies).values({ name: lead.companyName, ownerId: lead.ownerId }).returning();
      companyId = newCompany.id;
    }
  }

  // 2. Create Contact
  const [newContact] = await db.insert(contacts).values({
    firstName: lead.firstName,
    lastName: lead.lastName,
    email: lead.email,
    phone: lead.phone,
    mobile: lead.mobile,
    jobTitle: lead.jobTitle,
    ownerId: lead.ownerId,
    companyId: companyId,
    marketingConsent: lead.marketingConsent,
    consentDate: lead.consentDate,
    tags: lead.tags,
  }).returning();

  // 3. Create Deal if requested
  let dealId: string | undefined;
  if (shouldCreateDeal) {
    const [firstStage] = await db.select().from(pipelineStages).orderBy(pipelineStages.order).limit(1);
    if (!firstStage) throw new Error("No pipeline stages found. Please create one first.");

    const [newDeal] = await db.insert(deals).values({
      name: `Deal for ${lead.firstName} ${lead.lastName}`,
      amount: "0", // Default to 0, converted to string for numeric type
      currency: "USD",
      stageId: firstStage.id,
      companyId: companyId,
      contactId: newContact.id,
      ownerId: lead.ownerId,
      status: "open",
    }).returning();
    dealId = newDeal.id;
  }

  // 4. Update Lead status
  await db.update(leads).set({ status: "converted", isConverted: true }).where(eq(leads.id, leadId));

  revalidatePath("/dashboard/leads");
  revalidatePath("/dashboard/contacts");
  revalidatePath("/dashboard/companies");
  revalidatePath("/dashboard/pipeline");

  if (dealId) {
    redirect(`/dashboard/pipeline?dealId=${dealId}`);
  } else {
    redirect(`/dashboard/contacts?contactId=${newContact.id}`);
  }
}

export async function createContact(data: any) {
  const payload = {
    ...data,
    marketingConsent: data.marketingConsent ?? false,
    consentDate: data.marketingConsent && !data.consentDate ? new Date() : data.consentDate,
    tags: Array.isArray(data.tags) ? data.tags : typeof data.tags === 'string' ? data.tags.split(',').map((t: string) => t.trim()).filter(Boolean) : null,
  };
  const [newContact] = await db.insert(contacts).values(payload).returning();
  revalidatePath("/dashboard/contacts");
  dispatchWebhook("contact.created", { id: newContact.id, email: newContact.email, firstName: newContact.firstName, lastName: newContact.lastName }).catch(() => {});
  return newContact;
}

export async function updateContact(id: string, data: any) {
  const payload = {
    ...data,
    marketingConsent: data.marketingConsent ?? false,
    consentDate: data.marketingConsent && !data.consentDate ? new Date() : data.consentDate,
    tags: Array.isArray(data.tags) ? data.tags : typeof data.tags === 'string' ? data.tags.split(',').map((t: string) => t.trim()).filter(Boolean) : null,
  };
  const [updatedContact] = await db.update(contacts).set(payload).where(eq(contacts.id, id)).returning();
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
  const payload = {
    ...data,
    vatNumber: data.vatNumber,
    sdiCode: data.sdiCode,
    tags: Array.isArray(data.tags) ? data.tags : typeof data.tags === 'string' ? data.tags.split(',').map((t: string) => t.trim()).filter(Boolean) : null,
  };
  const [newCompany] = await db.insert(companies).values(payload).returning();
  revalidatePath("/dashboard/companies");
  return newCompany;
}

export async function updateCompany(id: string, data: any) {
  const payload = {
    ...data,
    vatNumber: data.vatNumber,
    sdiCode: data.sdiCode,
    tags: Array.isArray(data.tags) ? data.tags : typeof data.tags === 'string' ? data.tags.split(',').map((t: string) => t.trim()).filter(Boolean) : null,
  };
  const [updatedCompany] = await db.update(companies).set(payload).where(eq(companies.id, id)).returning();
  revalidatePath("/dashboard/companies");
  return updatedCompany;
}

export async function deleteCompany(id: string) {
  await db.delete(companies).where(eq(companies.id, id));
  revalidatePath("/dashboard/companies");
}
