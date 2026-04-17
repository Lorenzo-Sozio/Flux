"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { desc, eq, getTableColumns } from "drizzle-orm";
import { db } from "@/db";
import { companies, contacts, deals, leads, pipelineStages, users } from "@/db/schema";
import { dispatchWebhook } from "@/actions/webhooks";
import { createNotificationAction } from "@/actions/auth";
import { buildWhereClause, LEAD_FIELDS, CONTACT_FIELDS, COMPANY_FIELDS, customFieldsToRegistry } from "@/lib/filter-engine";
import { decodeFilter } from "@/lib/filter-types";
import type { FilterTree } from "@/lib/filter-types";
import { customFieldDefinitions } from "@/db/schema";
import { requireWriteAccess } from "@/lib/auth-guard";
import { computeLeadScore } from "@/lib/lead-score";

// ── Users ─────────────────────────────────────────────────────────────────────
export async function getAllUsers() {
  return db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .orderBy(users.name);
}

// LEADS
export async function getLeads(encodedFilter?: string | null) {
  const tree = encodedFilter ? decodeFilter(encodedFilter) : null;
  const base = db
    .select({ ...getTableColumns(leads), ownerName: users.name })
    .from(leads)
    .leftJoin(users, eq(leads.ownerId, users.id));
  if (!tree) return base.orderBy(desc(leads.createdAt));
  const customDefs = await db.select().from(customFieldDefinitions).where(eq(customFieldDefinitions.entityType, "lead"));
  const registry = { ...LEAD_FIELDS, ...customFieldsToRegistry(customDefs) };
  const where = buildWhereClause(tree, registry, leads.id);
  return base.where(where).orderBy(desc(leads.createdAt));
}

// CONTACTS
export async function getContacts(encodedFilter?: string | null) {
  const tree = encodedFilter ? decodeFilter(encodedFilter) : null;
  const base = db
    .select({ ...getTableColumns(contacts), ownerName: users.name })
    .from(contacts)
    .leftJoin(users, eq(contacts.ownerId, users.id));
  if (!tree) return base.orderBy(desc(contacts.createdAt));
  const customDefs = await db.select().from(customFieldDefinitions).where(eq(customFieldDefinitions.entityType, "contact"));
  const registry = { ...CONTACT_FIELDS, ...customFieldsToRegistry(customDefs) };
  const where = buildWhereClause(tree, registry, contacts.id);
  return base.where(where).orderBy(desc(contacts.createdAt));
}

export async function createLead(data: any) {
  await requireWriteAccess();
  const payload = {
    ...data,
    marketingConsent: data.marketingConsent ?? false,
    consentDate: data.marketingConsent && !data.consentDate ? new Date() : data.consentDate,
    tags: Array.isArray(data.tags) ? data.tags : typeof data.tags === 'string' ? data.tags.split(',').map((t: string) => t.trim()).filter(Boolean) : null,
    leadScore: computeLeadScore(data),
  };
  const [newLead] = await db.insert(leads).values(payload).returning();
  revalidatePath("/dashboard/leads");
  dispatchWebhook("lead.created", { id: newLead.id, email: newLead.email, firstName: newLead.firstName, lastName: newLead.lastName }).catch(() => {});
  return newLead;
}

export async function updateLead(id: string, data: any) {
  await requireWriteAccess();
  // Notify new assignee if ownerId changed
  if (data.ownerId) {
    const [cur] = await db.select({ ownerId: leads.ownerId, firstName: leads.firstName, lastName: leads.lastName }).from(leads).where(eq(leads.id, id));
    if (cur && cur.ownerId !== data.ownerId) {
      createNotificationAction({ userId: data.ownerId, type: "lead_assigned", title: "Lead assigned to you", message: `${cur.firstName} ${cur.lastName} has been assigned to you.`, link: `/dashboard/leads/${id}` }).catch(() => {});
    }
  }
  const payload = {
    ...data,
    marketingConsent: data.marketingConsent ?? false,
    consentDate: data.marketingConsent && !data.consentDate ? new Date() : data.consentDate,
    tags: Array.isArray(data.tags) ? data.tags : typeof data.tags === 'string' ? data.tags.split(',').map((t: string) => t.trim()).filter(Boolean) : null,
    leadScore: computeLeadScore(data),
  };
  const [updatedLead] = await db.update(leads).set(payload).where(eq(leads.id, id)).returning();
  revalidatePath("/dashboard/leads");
  return updatedLead;
}

export async function deleteLead(id: string) {
  await requireWriteAccess();
  await db.delete(leads).where(eq(leads.id, id));
  revalidatePath("/dashboard/leads");
}

export async function convertLead(leadId: string, shouldCreateDeal: boolean) {
  await requireWriteAccess();
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
  dispatchWebhook("lead.converted", { leadId, contactId: newContact.id, companyId: companyId ?? null, dealId: dealId ?? null }).catch(() => {});

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
  await requireWriteAccess();
  const payload = {
    ...data,
    marketingConsent: data.marketingConsent ?? false,
    consentDate: data.marketingConsent && !data.consentDate ? new Date() : data.consentDate,
    tags: Array.isArray(data.tags) ? data.tags : typeof data.tags === 'string' ? data.tags.split(',').map((t: string) => t.trim()).filter(Boolean) : null,
    leadScore: computeLeadScore(data),
  };
  const [newContact] = await db.insert(contacts).values(payload).returning();
  revalidatePath("/dashboard/contacts");
  dispatchWebhook("contact.created", { id: newContact.id, email: newContact.email, firstName: newContact.firstName, lastName: newContact.lastName }).catch(() => {});
  return newContact;
}

export async function updateContact(id: string, data: any) {
  await requireWriteAccess();
  // Notify new assignee if ownerId changed
  if (data.ownerId) {
    const [cur] = await db.select({ ownerId: contacts.ownerId, firstName: contacts.firstName, lastName: contacts.lastName }).from(contacts).where(eq(contacts.id, id));
    if (cur && cur.ownerId !== data.ownerId) {
      createNotificationAction({ userId: data.ownerId, type: "lead_assigned", title: "Contact assigned to you", message: `${cur.firstName} ${cur.lastName} has been assigned to you.`, link: `/dashboard/contacts/${id}` }).catch(() => {});
    }
  }
  const payload = {
    ...data,
    marketingConsent: data.marketingConsent ?? false,
    consentDate: data.marketingConsent && !data.consentDate ? new Date() : data.consentDate,
    tags: Array.isArray(data.tags) ? data.tags : typeof data.tags === 'string' ? data.tags.split(',').map((t: string) => t.trim()).filter(Boolean) : null,
    leadScore: computeLeadScore(data),
  };
  const [updatedContact] = await db.update(contacts).set(payload).where(eq(contacts.id, id)).returning();
  revalidatePath("/dashboard/contacts");
  dispatchWebhook("contact.updated", { id: updatedContact.id, email: updatedContact.email, firstName: updatedContact.firstName, lastName: updatedContact.lastName }).catch(() => {});
  return updatedContact;
}

export async function deleteContact(id: string) {
  await requireWriteAccess();
  await db.delete(contacts).where(eq(contacts.id, id));
  revalidatePath("/dashboard/contacts");
  dispatchWebhook("contact.deleted", { id }).catch(() => {});
}

// COMPANIES
export async function getCompanies(encodedFilter?: string | null) {
  const tree = encodedFilter ? decodeFilter(encodedFilter) : null;
  const base = db
    .select({ ...getTableColumns(companies), ownerName: users.name })
    .from(companies)
    .leftJoin(users, eq(companies.ownerId, users.id));
  if (!tree) return base.orderBy(desc(companies.createdAt));
  const customDefs = await db.select().from(customFieldDefinitions).where(eq(customFieldDefinitions.entityType, "company"));
  const registry = { ...COMPANY_FIELDS, ...customFieldsToRegistry(customDefs) };
  const where = buildWhereClause(tree, registry, companies.id);
  return base.where(where).orderBy(desc(companies.createdAt));
}

export async function createCompany(data: any) {
  await requireWriteAccess();
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
  await requireWriteAccess();
  // Notify new assignee if ownerId changed
  if (data.ownerId) {
    const [cur] = await db.select({ ownerId: companies.ownerId, name: companies.name }).from(companies).where(eq(companies.id, id));
    if (cur && cur.ownerId !== data.ownerId) {
      createNotificationAction({ userId: data.ownerId, type: "lead_assigned", title: "Company assigned to you", message: `${cur.name} has been assigned to you.`, link: `/dashboard/companies/${id}` }).catch(() => {});
    }
  }
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
  await requireWriteAccess();
  await db.delete(companies).where(eq(companies.id, id));
  revalidatePath("/dashboard/companies");
}

// ── Lightweight lists for FK select dropdowns ─────────────────────────────────

export async function getContactsForSelect() {
  return db
    .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName, email: contacts.email })
    .from(contacts)
    .orderBy(contacts.firstName, contacts.lastName);
}

export async function getCompaniesForSelect() {
  return db
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .orderBy(companies.name);
}

export async function getLeadsForSelect() {
  return db
    .select({ id: leads.id, firstName: leads.firstName, lastName: leads.lastName, email: leads.email })
    .from(leads)
    .orderBy(leads.firstName, leads.lastName);
}
