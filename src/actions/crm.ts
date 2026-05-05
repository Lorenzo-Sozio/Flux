"use server";

import { revalidatePath } from "next/cache";

import { and, desc, eq, getTableColumns, isNull } from "drizzle-orm";
import { getTranslations } from "next-intl/server";

import { createNotificationAction } from "@/actions/auth";
import { dispatchWebhook } from "@/actions/webhooks";
import { db } from "@/db";
import {
  activities,
  companies,
  contacts,
  customFieldDefinitions,
  deals,
  leads,
  pipelineStages,
  tasks,
  tickets,
  users,
} from "@/db/schema";
import { requireWriteAccess } from "@/lib/auth-guard";
import {
  buildWhereClause,
  COMPANY_FIELDS,
  CONTACT_FIELDS,
  customFieldsToRegistry,
  LEAD_FIELDS,
} from "@/lib/filter-engine";
import type { FilterTree } from "@/lib/filter-types";
import { decodeFilter } from "@/lib/filter-types";
import { computeLeadScore } from "@/lib/lead-score";

// ── Users ─────────────────────────────────────────────────────────────────────
export async function getAllUsers() {
  return db.select({ id: users.id, name: users.name, email: users.email }).from(users).orderBy(users.name);
}

// LEADS
export async function getLeads(encodedFilter?: string | null) {
  const tree = encodedFilter ? decodeFilter(encodedFilter) : null;
  const base = db
    .select({ ...getTableColumns(leads), ownerName: users.name })
    .from(leads)
    .leftJoin(users, eq(leads.ownerId, users.id));
  if (!tree) return base.orderBy(desc(leads.createdAt));
  const customDefs = await db
    .select()
    .from(customFieldDefinitions)
    .where(eq(customFieldDefinitions.entityType, "lead"));
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
  const customDefs = await db
    .select()
    .from(customFieldDefinitions)
    .where(eq(customFieldDefinitions.entityType, "contact"));
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
    tags: Array.isArray(data.tags)
      ? data.tags
      : typeof data.tags === "string"
        ? data.tags
            .split(",")
            .map((t: string) => t.trim())
            .filter(Boolean)
        : null,
    leadScore: computeLeadScore(data),
  };
  const [newLead] = await db.insert(leads).values(payload).returning();
  revalidatePath("/dashboard/leads");
  dispatchWebhook("lead.created", {
    id: newLead.id,
    email: newLead.email,
    firstName: newLead.firstName,
    lastName: newLead.lastName,
  }).catch(() => {});
  return newLead;
}

export async function updateLead(id: string, data: any) {
  await requireWriteAccess();
  // Notify new assignee if ownerId changed
  if (data.ownerId) {
    const [cur] = await db
      .select({ ownerId: leads.ownerId, firstName: leads.firstName, lastName: leads.lastName })
      .from(leads)
      .where(eq(leads.id, id));
    if (cur && cur.ownerId !== data.ownerId) {
      createNotificationAction({
        userId: data.ownerId,
        type: "lead_assigned",
        title: "Lead assigned to you",
        message: `${cur.firstName} ${cur.lastName} has been assigned to you.`,
        link: `/dashboard/leads/${id}`,
      }).catch(() => {});
    }
  }
  const payload = {
    ...data,
    marketingConsent: data.marketingConsent ?? false,
    consentDate: data.marketingConsent && !data.consentDate ? new Date() : data.consentDate,
    tags: Array.isArray(data.tags)
      ? data.tags
      : typeof data.tags === "string"
        ? data.tags
            .split(",")
            .map((t: string) => t.trim())
            .filter(Boolean)
        : null,
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
  if (lead.isConverted) throw new Error("Lead is already converted");

  // Fetch translation before transaction (next-intl doesn't belong inside a tx)
  const tLeads = await getTranslations("leads");
  const dealName = tLeads("dealForName", { firstName: lead.firstName, lastName: lead.lastName });

  let result: { contactId: string; companyId: string | null; dealId: string | null } | undefined;

  await db.transaction(async (tx) => {
    // 1. Create or find Company — copy all relevant lead fields to a new company
    let companyId: string | null = null;
    if (lead.companyName) {
      const [existing] = await tx
        .select({ id: companies.id, sourceLeadId: companies.sourceLeadId })
        .from(companies)
        .where(eq(companies.name, lead.companyName));

      if (existing) {
        companyId = existing.id;
        // Link back to source lead only when not already traced
        if (!existing.sourceLeadId) {
          await tx.update(companies).set({ sourceLeadId: lead.id }).where(eq(companies.id, existing.id));
        }
      } else {
        const [newCompany] = await tx
          .insert(companies)
          .values({
            name: lead.companyName,
            industry: lead.industry ?? undefined,
            website: lead.website ?? undefined,
            street: lead.street ?? undefined,
            city: lead.city ?? undefined,
            state: lead.state ?? undefined,
            zipCode: lead.zipCode ?? undefined,
            country: lead.country ?? undefined,
            source: lead.source ?? undefined,
            ownerId: lead.ownerId,
            sourceLeadId: lead.id,
          })
          .returning({ id: companies.id });
        companyId = newCompany.id;
      }
    }

    // 2. Create Contact from full lead profile
    const [newContact] = await tx
      .insert(contacts)
      .values({
        firstName: lead.firstName,
        lastName: lead.lastName,
        email: lead.email ?? undefined,
        phone: lead.phone ?? undefined,
        mobile: lead.mobile ?? undefined,
        jobTitle: lead.jobTitle ?? undefined,
        street: lead.street ?? undefined,
        city: lead.city ?? undefined,
        state: lead.state ?? undefined,
        zipCode: lead.zipCode ?? undefined,
        country: lead.country ?? undefined,
        source: lead.source ?? undefined,
        notes: lead.notes ?? undefined,
        ownerId: lead.ownerId,
        companyId: companyId ?? undefined,
        marketingConsent: lead.marketingConsent,
        consentDate: lead.consentDate ?? undefined,
        tags: lead.tags,
        sourceLeadId: lead.id,
      })
      .returning({ id: contacts.id });

    const contactId = newContact.id;

    // 3. Migrate activities — relink from lead to new contact + company
    await tx.update(activities).set({ leadId: null, contactId, companyId }).where(eq(activities.leadId, leadId));

    // 4. Migrate tasks — relink from lead to new contact + company
    await tx.update(tasks).set({ leadId: null, contactId, companyId }).where(eq(tasks.leadId, leadId));

    // 5. Migrate tickets — preserve existing contactId if already assigned
    await tx
      .update(tickets)
      .set({ leadId: null, contactId, companyId })
      .where(and(eq(tickets.leadId, leadId), isNull(tickets.contactId)));
    // Tickets that already had a contactId: just clear the leadId
    await tx.update(tickets).set({ leadId: null }).where(eq(tickets.leadId, leadId));

    // 6. Optionally create Deal
    let dealId: string | null = null;
    if (shouldCreateDeal) {
      const [firstStage] = await tx
        .select({ id: pipelineStages.id })
        .from(pipelineStages)
        .orderBy(pipelineStages.order)
        .limit(1);
      if (!firstStage) throw new Error("No pipeline stages found. Please create one first.");

      const [newDeal] = await tx
        .insert(deals)
        .values({
          name: dealName,
          amount: "0",
          currency: "EUR",
          stageId: firstStage.id,
          companyId: companyId ?? undefined,
          contactId,
          ownerId: lead.ownerId,
          status: "open",
        })
        .returning({ id: deals.id });
      dealId = newDeal.id;
    }

    // 7. Mark lead as converted with full traceability
    await tx
      .update(leads)
      .set({
        status: "converted",
        isConverted: true,
        convertedAt: new Date(),
        convertedToContactId: contactId,
        convertedToCompanyId: companyId,
        convertedToDealId: dealId,
      })
      .where(eq(leads.id, leadId));

    result = { contactId, companyId, dealId };
  });

  if (!result) throw new Error("Conversion transaction failed");

  dispatchWebhook("lead.converted", {
    leadId,
    contactId: result.contactId,
    companyId: result.companyId,
    dealId: result.dealId,
  }).catch(() => {});

  revalidatePath("/dashboard/leads");
  revalidatePath("/dashboard/contacts");
  revalidatePath("/dashboard/companies");
  revalidatePath("/dashboard/pipeline");

  return result;
}

export async function createContact(data: any) {
  await requireWriteAccess();
  const payload = {
    ...data,
    marketingConsent: data.marketingConsent ?? false,
    consentDate: data.marketingConsent && !data.consentDate ? new Date() : data.consentDate,
    tags: Array.isArray(data.tags)
      ? data.tags
      : typeof data.tags === "string"
        ? data.tags
            .split(",")
            .map((t: string) => t.trim())
            .filter(Boolean)
        : null,
    leadScore: computeLeadScore(data),
  };
  const [newContact] = await db.insert(contacts).values(payload).returning();
  revalidatePath("/dashboard/contacts");
  dispatchWebhook("contact.created", {
    id: newContact.id,
    email: newContact.email,
    firstName: newContact.firstName,
    lastName: newContact.lastName,
  }).catch(() => {});
  return newContact;
}

export async function updateContact(id: string, data: any) {
  await requireWriteAccess();
  // Notify new assignee if ownerId changed
  if (data.ownerId) {
    const [cur] = await db
      .select({ ownerId: contacts.ownerId, firstName: contacts.firstName, lastName: contacts.lastName })
      .from(contacts)
      .where(eq(contacts.id, id));
    if (cur && cur.ownerId !== data.ownerId) {
      createNotificationAction({
        userId: data.ownerId,
        type: "lead_assigned",
        title: "Contact assigned to you",
        message: `${cur.firstName} ${cur.lastName} has been assigned to you.`,
        link: `/dashboard/contacts/${id}`,
      }).catch(() => {});
    }
  }
  const payload = {
    ...data,
    marketingConsent: data.marketingConsent ?? false,
    consentDate: data.marketingConsent && !data.consentDate ? new Date() : data.consentDate,
    tags: Array.isArray(data.tags)
      ? data.tags
      : typeof data.tags === "string"
        ? data.tags
            .split(",")
            .map((t: string) => t.trim())
            .filter(Boolean)
        : null,
    leadScore: computeLeadScore(data),
  };
  const [updatedContact] = await db.update(contacts).set(payload).where(eq(contacts.id, id)).returning();
  revalidatePath("/dashboard/contacts");
  dispatchWebhook("contact.updated", {
    id: updatedContact.id,
    email: updatedContact.email,
    firstName: updatedContact.firstName,
    lastName: updatedContact.lastName,
  }).catch(() => {});
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
  const customDefs = await db
    .select()
    .from(customFieldDefinitions)
    .where(eq(customFieldDefinitions.entityType, "company"));
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
    tags: Array.isArray(data.tags)
      ? data.tags
      : typeof data.tags === "string"
        ? data.tags
            .split(",")
            .map((t: string) => t.trim())
            .filter(Boolean)
        : null,
  };
  const [newCompany] = await db.insert(companies).values(payload).returning();
  revalidatePath("/dashboard/companies");
  return newCompany;
}

export async function updateCompany(id: string, data: any) {
  await requireWriteAccess();
  // Notify new assignee if ownerId changed
  if (data.ownerId) {
    const [cur] = await db
      .select({ ownerId: companies.ownerId, name: companies.name })
      .from(companies)
      .where(eq(companies.id, id));
    if (cur && cur.ownerId !== data.ownerId) {
      createNotificationAction({
        userId: data.ownerId,
        type: "lead_assigned",
        title: "Company assigned to you",
        message: `${cur.name} has been assigned to you.`,
        link: `/dashboard/companies/${id}`,
      }).catch(() => {});
    }
  }
  const payload = {
    ...data,
    vatNumber: data.vatNumber,
    sdiCode: data.sdiCode,
    tags: Array.isArray(data.tags)
      ? data.tags
      : typeof data.tags === "string"
        ? data.tags
            .split(",")
            .map((t: string) => t.trim())
            .filter(Boolean)
        : null,
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
  return db.select({ id: companies.id, name: companies.name }).from(companies).orderBy(companies.name);
}

export async function getLeadsForSelect() {
  return db
    .select({ id: leads.id, firstName: leads.firstName, lastName: leads.lastName, email: leads.email })
    .from(leads)
    .orderBy(leads.firstName, leads.lastName);
}
