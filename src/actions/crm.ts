"use server";

import { revalidatePath } from "next/cache";

import { and, desc, eq, getTableColumns, ilike, isNull, ne, or } from "drizzle-orm";
import { getTranslations } from "next-intl/server";

import { createNotificationAction } from "@/actions/auth";
import { dispatchWebhook } from "@/actions/webhooks";
import { getDb } from "@/lib/tenant-context";
import {
  activities,
  appointments,
  campaignLogs,
  companies,
  companyCategories,
  companyTypes,
  contacts,
  customFieldDefinitions,
  deals,
  leads,
  pipelineStages,
  quotes,
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

// ── Company lookup tables ──────────────────────────────────────────────────────

export async function getCompanyCategories() {
  const db = await getDb();
  return db
    .select({ id: companyCategories.id, name: companyCategories.name })
    .from(companyCategories)
    .orderBy(companyCategories.name);
}

export async function getCompanyTypes() {
  const db = await getDb();
  return db
    .select({ id: companyTypes.id, name: companyTypes.name })
    .from(companyTypes)
    .orderBy(companyTypes.name);
}

export async function createCompanyCategory(name: string) {
  await requireWriteAccess();
  const db = await getDb();
  const [row] = await db
    .insert(companyCategories)
    .values({ name: name.trim() })
    .returning({ id: companyCategories.id, name: companyCategories.name });
  revalidatePath("/dashboard/companies");
  return row;
}

export async function createCompanyType(name: string) {
  await requireWriteAccess();
  const db = await getDb();
  const [row] = await db
    .insert(companyTypes)
    .values({ name: name.trim() })
    .returning({ id: companyTypes.id, name: companyTypes.name });
  revalidatePath("/dashboard/companies");
  return row;
}

// ── Users ─────────────────────────────────────────────────────────────────────
export async function getAllUsers() {
  const db = await getDb();
  return db.select({ id: users.id, name: users.name, email: users.email }).from(users).orderBy(users.name);
}

// LEADS
export async function getLeads(encodedFilter?: string | null) {
  const db = await getDb();
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
  const db = await getDb();
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
  const db = await getDb();
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
  const db = await getDb();
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
  const db = await getDb();
  await db.delete(leads).where(eq(leads.id, id));
  revalidatePath("/dashboard/leads");
}

export async function convertLead(leadId: string, shouldCreateDeal: boolean) {
  await requireWriteAccess();
  const db = await getDb();

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
            companyTypeId: lead.leadTypeId ?? undefined,
            companyCategoryId: lead.leadCategoryId ?? undefined,
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
  const db = await getDb();
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
  const db = await getDb();
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
  const db = await getDb();
  await db.delete(contacts).where(eq(contacts.id, id));
  revalidatePath("/dashboard/contacts");
  dispatchWebhook("contact.deleted", { id }).catch(() => {});
}

// COMPANIES
export async function getCompanies(encodedFilter?: string | null) {
  const db = await getDb();
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
  const db = await getDb();
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
  const db = await getDb();
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
  const db = await getDb();
  await db.delete(companies).where(eq(companies.id, id));
  revalidatePath("/dashboard/companies");
}

// ── Lightweight lists for FK select dropdowns ─────────────────────────────────

export async function getContactsForSelect() {
  const db = await getDb();
  return db
    .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName, email: contacts.email })
    .from(contacts)
    .orderBy(contacts.firstName, contacts.lastName);
}

export async function getCompaniesForSelect() {
  const db = await getDb();
  return db.select({ id: companies.id, name: companies.name }).from(companies).orderBy(companies.name);
}

export async function getLeadsForSelect() {
  const db = await getDb();
  return db
    .select({ id: leads.id, firstName: leads.firstName, lastName: leads.lastName, email: leads.email })
    .from(leads)
    .orderBy(leads.firstName, leads.lastName);
}

// ── Duplicate detection ───────────────────────────────────────────────────────

export async function checkLeadDuplicates(params: {

  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  excludeId?: string;
}) {
  const db = await getDb();
  const { email, phone, firstName, lastName, excludeId } = params;
  const conditions = [];
  if (email?.trim()) conditions.push(ilike(leads.email, email.trim()));
  if (phone?.trim()) conditions.push(ilike(leads.phone, phone.trim()));
  if (firstName?.trim() && lastName?.trim()) {
    conditions.push(and(ilike(leads.firstName, firstName.trim()), ilike(leads.lastName, lastName.trim())));
  }
  if (!conditions.length) return [];

  const base = or(...conditions)!;
  const where = excludeId ? and(base, ne(leads.id, excludeId)) : base;

  return db
    .select({
      id: leads.id,
      firstName: leads.firstName,
      lastName: leads.lastName,
      email: leads.email,
      phone: leads.phone,
    })
    .from(leads)
    .where(where)
    .limit(5);
}

export async function checkContactDuplicates(params: {

  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  excludeId?: string;
}) {
  const db = await getDb();
  const { email, phone, firstName, lastName, excludeId } = params;
  const conditions = [];
  if (email?.trim()) conditions.push(ilike(contacts.email, email.trim()));
  if (phone?.trim()) conditions.push(ilike(contacts.phone, phone.trim()));
  if (firstName?.trim() && lastName?.trim()) {
    conditions.push(and(ilike(contacts.firstName, firstName.trim()), ilike(contacts.lastName, lastName.trim())));
  }
  if (!conditions.length) return [];

  const base = or(...conditions)!;
  const where = excludeId ? and(base, ne(contacts.id, excludeId)) : base;

  return db
    .select({
      id: contacts.id,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      email: contacts.email,
      phone: contacts.phone,
    })
    .from(contacts)
    .where(where)
    .limit(5);
}

export async function checkCompanyDuplicates(params: {

  name?: string | null;
  website?: string | null;
  mainEmail?: string | null;
  excludeId?: string;
}) {
  const db = await getDb();
  const { name, website, mainEmail, excludeId } = params;
  const conditions = [];
  if (name?.trim()) conditions.push(ilike(companies.name, name.trim()));
  if (website?.trim()) conditions.push(ilike(companies.website, website.trim()));
  if (mainEmail?.trim()) conditions.push(ilike(companies.mainEmail, mainEmail.trim()));
  if (!conditions.length) return [];

  const base = or(...conditions)!;
  const where = excludeId ? and(base, ne(companies.id, excludeId)) : base;

  return db
    .select({
      id: companies.id,
      name: companies.name,
      mainEmail: companies.mainEmail,
      website: companies.website,
    })
    .from(companies)
    .where(where)
    .limit(5);
}

// ── Merge helpers ─────────────────────────────────────────────────────────────

export async function getLeadForMerge(id: string) {
  await requireWriteAccess();
  const db = await getDb();
  return db.query.leads.findFirst({ where: eq(leads.id, id) });
}

type LeadMergeFields = {
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  jobTitle?: string | null;
  companyName?: string | null;
  industry?: string | null;
  website?: string | null;
  notes?: string | null;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  country?: string | null;
  source?: string | null;
  ownerId?: string | null;
};

export async function mergeLeads(keepId: string, mergeId: string, fields: LeadMergeFields) {
  await requireWriteAccess();
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx
      .update(leads)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(leads.id, keepId));
    await Promise.all([
      tx.update(activities).set({ leadId: keepId }).where(eq(activities.leadId, mergeId)),
      tx.update(tasks).set({ leadId: keepId }).where(eq(tasks.leadId, mergeId)),
      tx.update(campaignLogs).set({ leadId: keepId }).where(eq(campaignLogs.leadId, mergeId)),
      tx.update(tickets).set({ leadId: keepId }).where(eq(tickets.leadId, mergeId)),
      tx.update(appointments).set({ leadId: keepId }).where(eq(appointments.leadId, mergeId)),
    ]);
    await tx.delete(leads).where(eq(leads.id, mergeId));
  });
  revalidatePath("/dashboard/leads");
}

export async function getContactForMerge(id: string) {
  await requireWriteAccess();
  const db = await getDb();
  return db.query.contacts.findFirst({
    where: eq(contacts.id, id),
    with: { company: { columns: { id: true, name: true } } },
  });
}

export async function getCompanyForMerge(id: string) {
  await requireWriteAccess();
  const db = await getDb();
  return db.query.companies.findFirst({ where: eq(companies.id, id) });
}

type ContactMergeFields = {
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  jobTitle?: string | null;
  department?: string | null;
  linkedinUrl?: string | null;
  notes?: string | null;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  country?: string | null;
  source?: string | null;
  companyId?: string | null;
  ownerId?: string | null;
};

export async function mergeContacts(keepId: string, mergeId: string, fields: ContactMergeFields) {
  await requireWriteAccess();
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx
      .update(contacts)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(contacts.id, keepId));
    await Promise.all([
      tx.update(activities).set({ contactId: keepId }).where(eq(activities.contactId, mergeId)),
      tx.update(tasks).set({ contactId: keepId }).where(eq(tasks.contactId, mergeId)),
      tx.update(deals).set({ contactId: keepId }).where(eq(deals.contactId, mergeId)),
      tx.update(quotes).set({ contactId: keepId }).where(eq(quotes.contactId, mergeId)),
      tx.update(tickets).set({ contactId: keepId }).where(eq(tickets.contactId, mergeId)),
      tx.update(appointments).set({ contactId: keepId }).where(eq(appointments.contactId, mergeId)),
    ]);
    await tx.delete(contacts).where(eq(contacts.id, mergeId));
  });
  revalidatePath("/dashboard/contacts");
}

type CompanyMergeFields = {
  mainEmail?: string | null;
  mainPhone?: string | null;
  website?: string | null;
  description?: string | null;
  industry?: string | null;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  country?: string | null;
  vatNumber?: string | null;
  sdiCode?: string | null;
  linkedinUrl?: string | null;
  source?: string | null;
  ownerId?: string | null;
};

export async function mergeCompanies(keepId: string, mergeId: string, fields: CompanyMergeFields) {
  await requireWriteAccess();
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx
      .update(companies)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(companies.id, keepId));
    await Promise.all([
      tx.update(contacts).set({ companyId: keepId }).where(eq(contacts.companyId, mergeId)),
      tx.update(activities).set({ companyId: keepId }).where(eq(activities.companyId, mergeId)),
      tx.update(tasks).set({ companyId: keepId }).where(eq(tasks.companyId, mergeId)),
      tx.update(deals).set({ companyId: keepId }).where(eq(deals.companyId, mergeId)),
      tx.update(quotes).set({ companyId: keepId }).where(eq(quotes.companyId, mergeId)),
      tx.update(tickets).set({ companyId: keepId }).where(eq(tickets.companyId, mergeId)),
      tx.update(appointments).set({ companyId: keepId }).where(eq(appointments.companyId, mergeId)),
    ]);
    await tx.delete(companies).where(eq(companies.id, mergeId));
  });
  revalidatePath("/dashboard/companies");
}
