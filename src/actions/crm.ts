"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { and, asc, count, desc, eq, getTableColumns, ilike, isNull, ne, or, type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { getTranslations } from "next-intl/server";

import { createNotificationAction } from "@/actions/auth";
import {
  CompanySchema,
  CompanyUpdateSchema,
  ContactSchema,
  ContactUpdateSchema,
  definedOnly,
  LeadSchema,
  LeadUpdateSchema,
} from "@/actions/crm-validation";
import { dispatchWebhook } from "@/actions/webhooks";
import { runAutomations } from "@/components/crm/automation/rule-engine";
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
import { guarded } from "@/lib/action-error";
import { requireCapability, requirePlanLimit, requireWriteAccess } from "@/lib/auth-guard";
import { isSameCompanyName, normalizeCompanyName } from "@/lib/company-name";
import {
  buildWhereClause,
  COMPANY_FIELDS,
  CONTACT_FIELDS,
  customFieldsToRegistry,
  LEAD_FIELDS,
} from "@/lib/filter-engine";
import { decodeFilter } from "@/lib/filter-types";
import { computeLeadScore } from "@/lib/lead-score";
import { type ListParams, offsetOf, type Page, toPage } from "@/lib/pagination";
import { getDb } from "@/lib/tenant-context";

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
  return db.select({ id: companyTypes.id, name: companyTypes.name }).from(companyTypes).orderBy(companyTypes.name);
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

// ─── Record-limit helper ──────────────────────────────────────────────────────

async function getTotalRecordCount(db: Awaited<ReturnType<typeof getDb>>): Promise<number> {
  const [[c], [l], [co], [d]] = await Promise.all([
    db.select({ n: count() }).from(contacts),
    db.select({ n: count() }).from(leads),
    db.select({ n: count() }).from(companies),
    db.select({ n: count() }).from(deals),
  ]);
  return Number(c?.n ?? 0) + Number(l?.n ?? 0) + Number(co?.n ?? 0) + Number(d?.n ?? 0);
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

/**
 * The most recently created leads, for the dashboard.
 *
 * The dashboard used to call `getLeads()` — every lead, every column — sort them
 * in JavaScript and keep five (audit rilievo B-08).
 */
export async function getRecentLeads(limit = 5) {
  const db = await getDb();
  return db
    .select({
      id: leads.id,
      firstName: leads.firstName,
      lastName: leads.lastName,
      email: leads.email,
      companyName: leads.companyName,
      status: leads.status,
      rating: leads.rating,
      leadScore: leads.leadScore,
      createdAt: leads.createdAt,
    })
    .from(leads)
    .where(eq(leads.isConverted, false))
    .orderBy(desc(leads.createdAt))
    .limit(limit);
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

export async function createLead(data: unknown) {
  return guarded(async () => {
    await requireWriteAccess();
    const db = await getDb();
    // Validated with the same schema the form uses, so a bad value is a message
    // on the field rather than a Postgres error naming a column (rilievo M-08).
    const validated = LeadSchema.parse(data);
    await requirePlanLimit("maxRecords", await getTotalRecordCount(db));
    const payload = {
      ...validated,
      leadScore: computeLeadScore(validated),
    };
    const [newLead] = await db.insert(leads).values(payload).returning();
    revalidatePath("/dashboard/leads");
    dispatchWebhook("lead.created", {
      id: newLead.id,
      email: newLead.email,
      firstName: newLead.firstName,
      lastName: newLead.lastName,
      // biome-ignore lint/suspicious/noEmptyBlockStatements: fire-and-forget
    }).catch(() => {});

    // The rule builder has always offered this entity; nothing ever called the
    // engine for it (audit rilievo D-02). `after()` keeps it off the response path.
    after(() =>
      runAutomations({
        entityType: "lead",
        entityId: newLead.id,
        event: "onCreate",
        oldData: {},
        newData: newLead as Record<string, unknown>,
      }),
    );
    return { lead: newLead };
  });
}

export async function updateLead(id: string, data: unknown) {
  return guarded(async () => {
    await requireWriteAccess();
    const db = await getDb();
    // Validated with the same schema the form uses, so a bad value is a message
    // on the field rather than a Postgres error naming a column (rilievo M-08).
    const validated = definedOnly(LeadUpdateSchema.parse(data));
    // Read before the write: the automation engine compares old and new to
    // decide whether a field `changed`, and cannot do that after the fact.
    const [previous] = await db.select().from(leads).where(eq(leads.id, id));
    // Notify new assignee if ownerId changed
    if (validated.ownerId) {
      const [cur] = await db
        .select({ ownerId: leads.ownerId, firstName: leads.firstName, lastName: leads.lastName })
        .from(leads)
        .where(eq(leads.id, id));
      if (cur && cur.ownerId !== validated.ownerId) {
        createNotificationAction({
          userId: validated.ownerId,
          type: "lead_assigned",
          title: "Lead assigned to you",
          message: `${cur.firstName} ${cur.lastName} has been assigned to you.`,
          link: `/dashboard/leads/${id}`,
          // biome-ignore lint/suspicious/noEmptyBlockStatements: fire-and-forget
        }).catch(() => {});
      }
    }
    const payload = {
      ...validated,
      leadScore: computeLeadScore(validated),
    };
    const [updatedLead] = await db.update(leads).set(payload).where(eq(leads.id, id)).returning();
    revalidatePath("/dashboard/leads");

    after(() =>
      runAutomations({
        entityType: "lead",
        entityId: updatedLead.id,
        event: "onUpdate",
        // The engine's `changed`, `changed_to` and `changed_from` operators are
        // meaningless without the previous row, so it is read before the write.
        oldData: (previous ?? {}) as Record<string, unknown>,
        newData: updatedLead as Record<string, unknown>,
      }),
    );
    return { lead: updatedLead };
  });
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
  await requirePlanLimit("maxRecords", await getTotalRecordCount(db));

  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId));
  if (!lead) throw new Error("Lead not found");
  if (lead.isConverted) throw new Error("Lead is already converted");

  const tLeads = await getTranslations("leads");
  const dealName = tLeads("dealForName", { firstName: lead.firstName, lastName: lead.lastName });

  // Everything this function writes is collected first and committed together.
  //
  // It used to write eight rows one at a time, under a comment promising a
  // transaction that was never opened. A failure partway through left an orphan
  // company and contact, activities already moved off a lead still marked
  // unconverted, and no way to tell from the data which half had happened
  // (audit rilievi M-03, M-04).
  //
  // `db.transaction()` throws on the Neon HTTP driver. `db.batch()` maps to Neon's
  // transaction endpoint, at the cost that no statement may read another's output —
  // hence the ids below are chosen here rather than by the database default.
  const writes: unknown[] = [];

  // 1. Create or find Company.
  //
  // Matching on the exact name is why "ACME Srl" and "Acme S.r.l." became two
  // companies. A normalised comparison catches the ordinary variations; the VAT
  // number catches the rest, and is the only truly reliable key.
  let companyId: string | null = null;
  if (lead.companyName) {
    const normalized = normalizeCompanyName(lead.companyName);
    const candidates = await db
      .select({ id: companies.id, name: companies.name, sourceLeadId: companies.sourceLeadId })
      .from(companies);
    const existing = candidates.find((c) => normalizeCompanyName(c.name) === normalized);

    if (existing) {
      companyId = existing.id;
      // Link back to source lead only when not already traced
      if (!existing.sourceLeadId) {
        writes.push(db.update(companies).set({ sourceLeadId: lead.id }).where(eq(companies.id, existing.id)));
      }
    } else {
      companyId = crypto.randomUUID();
      writes.push(
        db.insert(companies).values({
          id: companyId,
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
        }),
      );
    }
  }

  // 2. Create Contact from full lead profile.
  //
  // Converting the same person twice used to produce two contacts: the duplicate
  // check existed in this very file and was never called from here.
  const duplicate = lead.email
    ? (await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.email, lead.email)).limit(1))[0]
    : undefined;

  const contactId = duplicate?.id ?? crypto.randomUUID();

  if (!duplicate) {
    writes.push(
      db.insert(contacts).values({
        id: contactId,
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
      }),
    );
  }

  // 3. Migrate activities — relink from lead to new contact + company
  writes.push(db.update(activities).set({ leadId: null, contactId, companyId }).where(eq(activities.leadId, leadId)));

  // 4. Migrate tasks — relink from lead to new contact + company
  writes.push(db.update(tasks).set({ leadId: null, contactId, companyId }).where(eq(tasks.leadId, leadId)));

  // 5. Migrate tickets — preserve existing contactId if already assigned
  writes.push(
    db
      .update(tickets)
      .set({ leadId: null, contactId, companyId })
      .where(and(eq(tickets.leadId, leadId), isNull(tickets.contactId))),
  );
  // Tickets that already had a contactId: just clear the leadId
  writes.push(db.update(tickets).set({ leadId: null }).where(eq(tickets.leadId, leadId)));

  // 6. Optionally create Deal
  let dealId: string | null = null;
  if (shouldCreateDeal) {
    const [firstStage] = await db
      .select({ id: pipelineStages.id })
      .from(pipelineStages)
      .orderBy(pipelineStages.order)
      .limit(1);
    if (!firstStage) throw new Error("No pipeline stages found. Please create one first.");

    dealId = crypto.randomUUID();
    writes.push(
      db.insert(deals).values({
        id: dealId,
        name: dealName,
        amount: "0",
        currency: "EUR",
        stageId: firstStage.id,
        companyId: companyId ?? undefined,
        contactId,
        ownerId: lead.ownerId,
        status: "open",
      }),
    );
  }

  // 7. Mark lead as converted with full traceability
  writes.push(
    db
      .update(leads)
      .set({
        status: "converted",
        isConverted: true,
        convertedAt: new Date(),
        convertedToContactId: contactId,
        convertedToCompanyId: companyId,
        convertedToDealId: dealId,
      })
      .where(eq(leads.id, leadId)),
  );

  // One commit. Either the lead is converted and everything moved with it, or
  // nothing happened and it can be retried.
  await db.batch(writes as unknown as Parameters<typeof db.batch>[0]);

  const result = { contactId, companyId, dealId };

  dispatchWebhook("lead.converted", {
    leadId,
    contactId: result.contactId,
    companyId: result.companyId,
    dealId: result.dealId,
    // biome-ignore lint/suspicious/noEmptyBlockStatements: fire-and-forget
  }).catch(() => {});

  revalidatePath("/dashboard/leads");
  revalidatePath("/dashboard/contacts");
  revalidatePath("/dashboard/companies");
  revalidatePath("/dashboard/pipeline");

  return result;
}

export async function createContact(data: unknown) {
  return guarded(async () => {
    await requireWriteAccess();
    const db = await getDb();
    // Validated with the same schema the form uses, so a bad value is a message
    // on the field rather than a Postgres error naming a column (rilievo M-08).
    const validated = ContactSchema.parse(data);
    await requirePlanLimit("maxRecords", await getTotalRecordCount(db));
    const payload = {
      ...validated,
      leadScore: computeLeadScore(validated),
    };
    const [newContact] = await db.insert(contacts).values(payload).returning();
    revalidatePath("/dashboard/contacts");
    dispatchWebhook("contact.created", {
      id: newContact.id,
      email: newContact.email,
      firstName: newContact.firstName,
      lastName: newContact.lastName,
      // biome-ignore lint/suspicious/noEmptyBlockStatements: fire-and-forget
    }).catch(() => {});

    // The rule builder has always offered this entity; nothing ever called the
    // engine for it (audit rilievo D-02). `after()` keeps it off the response path.
    after(() =>
      runAutomations({
        entityType: "contact",
        entityId: newContact.id,
        event: "onCreate",
        oldData: {},
        newData: newContact as Record<string, unknown>,
      }),
    );
    return { contact: newContact };
  });
}

export async function updateContact(id: string, data: unknown) {
  return guarded(async () => {
    await requireWriteAccess();
    const db = await getDb();
    // Validated with the same schema the form uses, so a bad value is a message
    // on the field rather than a Postgres error naming a column (rilievo M-08).
    const validated = definedOnly(ContactUpdateSchema.parse(data));
    // Read before the write: the automation engine compares old and new to
    // decide whether a field `changed`, and cannot do that after the fact.
    const [previous] = await db.select().from(contacts).where(eq(contacts.id, id));
    // Notify new assignee if ownerId changed
    if (validated.ownerId) {
      const [cur] = await db
        .select({ ownerId: contacts.ownerId, firstName: contacts.firstName, lastName: contacts.lastName })
        .from(contacts)
        .where(eq(contacts.id, id));
      if (cur && cur.ownerId !== validated.ownerId) {
        createNotificationAction({
          userId: validated.ownerId,
          type: "lead_assigned",
          title: "Contact assigned to you",
          message: `${cur.firstName} ${cur.lastName} has been assigned to you.`,
          link: `/dashboard/contacts/${id}`,
          // biome-ignore lint/suspicious/noEmptyBlockStatements: fire-and-forget
        }).catch(() => {});
      }
    }
    const payload = {
      ...validated,
      leadScore: computeLeadScore(validated),
    };
    const [updatedContact] = await db.update(contacts).set(payload).where(eq(contacts.id, id)).returning();
    revalidatePath("/dashboard/contacts");
    dispatchWebhook("contact.updated", {
      id: updatedContact.id,
      email: updatedContact.email,
      firstName: updatedContact.firstName,
      lastName: updatedContact.lastName,
      // biome-ignore lint/suspicious/noEmptyBlockStatements: fire-and-forget
    }).catch(() => {});

    after(() =>
      runAutomations({
        entityType: "contact",
        entityId: updatedContact.id,
        event: "onUpdate",
        // The engine's `changed`, `changed_to` and `changed_from` operators are
        // meaningless without the previous row, so it is read before the write.
        oldData: (previous ?? {}) as Record<string, unknown>,
        newData: updatedContact as Record<string, unknown>,
      }),
    );
    return { contact: updatedContact };
  });
}

export async function deleteContact(id: string) {
  await requireWriteAccess();
  const db = await getDb();
  await db.delete(contacts).where(eq(contacts.id, id));
  revalidatePath("/dashboard/contacts");
  // biome-ignore lint/suspicious/noEmptyBlockStatements: fire-and-forget
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

export async function createCompany(data: unknown) {
  return guarded(async () => {
    await requireWriteAccess();
    const db = await getDb();
    // Validated with the same schema the form uses, so a bad value is a message
    // on the field rather than a Postgres error naming a column (rilievo M-08).
    const validated = CompanySchema.parse(data);
    await requirePlanLimit("maxRecords", await getTotalRecordCount(db));
    const payload = { ...validated };
    const [newCompany] = await db.insert(companies).values(payload).returning();
    revalidatePath("/dashboard/companies");

    // The rule builder has always offered this entity; nothing ever called the
    // engine for it (audit rilievo D-02). `after()` keeps it off the response path.
    after(() =>
      runAutomations({
        entityType: "company",
        entityId: newCompany.id,
        event: "onCreate",
        oldData: {},
        newData: newCompany as Record<string, unknown>,
      }),
    );
    return { company: newCompany };
  });
}

export async function updateCompany(id: string, data: unknown) {
  return guarded(async () => {
    await requireWriteAccess();
    const db = await getDb();
    // Validated with the same schema the form uses, so a bad value is a message
    // on the field rather than a Postgres error naming a column (rilievo M-08).
    const validated = definedOnly(CompanyUpdateSchema.parse(data));
    // Read before the write: the automation engine compares old and new to
    // decide whether a field `changed`, and cannot do that after the fact.
    const [previous] = await db.select().from(companies).where(eq(companies.id, id));
    // Notify new assignee if ownerId changed
    if (validated.ownerId) {
      const [cur] = await db
        .select({ ownerId: companies.ownerId, name: companies.name })
        .from(companies)
        .where(eq(companies.id, id));
      if (cur && cur.ownerId !== validated.ownerId) {
        createNotificationAction({
          userId: validated.ownerId,
          type: "lead_assigned",
          title: "Company assigned to you",
          message: `${cur.name} has been assigned to you.`,
          link: `/dashboard/companies/${id}`,
          // biome-ignore lint/suspicious/noEmptyBlockStatements: fire-and-forget
        }).catch(() => {});
      }
    }
    const payload = { ...validated };
    const [updatedCompany] = await db.update(companies).set(payload).where(eq(companies.id, id)).returning();
    revalidatePath("/dashboard/companies");

    after(() =>
      runAutomations({
        entityType: "company",
        entityId: updatedCompany.id,
        event: "onUpdate",
        // The engine's `changed`, `changed_to` and `changed_from` operators are
        // meaningless without the previous row, so it is read before the write.
        oldData: (previous ?? {}) as Record<string, unknown>,
        newData: updatedCompany as Record<string, unknown>,
      }),
    );
    return { company: updatedCompany };
  });
}

export async function deleteCompany(id: string) {
  await requireWriteAccess();
  const db = await getDb();

  // Free any lead that was converted into this company so it can be re-converted
  await db
    .update(leads)
    .set({
      isConverted: false,
      status: "open",
      convertedAt: null,
      convertedToCompanyId: null,
      convertedToContactId: null,
      convertedToDealId: null,
    })
    .where(eq(leads.convertedToCompanyId, id));

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
//
// These ran only at save time, after every tab of the form had been filled in
// (audit rilievo U-13). They are cheap and bounded, so they now also run while
// the identifying field is being typed — see `useDuplicateWatch`. That makes them
// a probe anyone with a session could aim at the workspace, so they are guarded
// like any other read.

export async function checkLeadDuplicates(params: {
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  excludeId?: string;
}) {
  await requireCapability("record:read");
  const db = await getDb();
  const { email, phone, firstName, lastName, excludeId } = params;
  const conditions = [];
  if (email?.trim()) conditions.push(ilike(leads.email, email.trim()));
  if (phone?.trim()) conditions.push(ilike(leads.phone, phone.trim()));
  if (firstName?.trim() && lastName?.trim()) {
    conditions.push(and(ilike(leads.firstName, firstName.trim()), ilike(leads.lastName, lastName.trim())));
  }
  if (!conditions.length) return [];

  // biome-ignore lint/style/noNonNullAssertion: or() returns SQL when conditions array is non-empty (guard above)
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
  await requireCapability("record:read");
  const db = await getDb();
  const { email, phone, firstName, lastName, excludeId } = params;
  const conditions = [];
  if (email?.trim()) conditions.push(ilike(contacts.email, email.trim()));
  if (phone?.trim()) conditions.push(ilike(contacts.phone, phone.trim()));
  if (firstName?.trim() && lastName?.trim()) {
    conditions.push(and(ilike(contacts.firstName, firstName.trim()), ilike(contacts.lastName, lastName.trim())));
  }
  if (!conditions.length) return [];

  // biome-ignore lint/style/noNonNullAssertion: or() returns SQL when conditions array is non-empty (guard above)
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
  await requireCapability("record:read");
  const db = await getDb();
  const { name, website, mainEmail, excludeId } = params;
  const conditions = [];

  // The exact match this used to do never fired on the case that matters: nobody
  // types the same legal form twice. "Acme S.r.l." and "Acme Srl" are one company,
  // and the check has to say so or it is decoration (rilievo U-13).
  //
  // The narrowing happens in SQL on the longest word of the name, so the scan stays
  // bounded; the decision happens in `isSameCompanyName`, which knows about legal
  // forms, punctuation and accents.
  const anchor = longestWord(name);
  if (anchor) conditions.push(ilike(companies.name, `%${anchor}%`));
  if (website?.trim()) conditions.push(ilike(companies.website, `%${hostOf(website)}%`));
  if (mainEmail?.trim()) conditions.push(ilike(companies.mainEmail, mainEmail.trim()));
  if (!conditions.length) return [];

  // biome-ignore lint/style/noNonNullAssertion: or() returns SQL when conditions array is non-empty (guard above)
  const base = or(...conditions)!;
  const where = excludeId ? and(base, ne(companies.id, excludeId)) : base;

  const candidates = await db
    .select({
      id: companies.id,
      name: companies.name,
      mainEmail: companies.mainEmail,
      website: companies.website,
    })
    .from(companies)
    .where(where)
    .limit(40);

  const typedName = name?.trim() ?? "";
  const typedHost = hostOf(website);
  const typedEmail = mainEmail?.trim().toLowerCase() ?? "";

  return candidates
    .filter(
      (c) =>
        (typedName !== "" && isSameCompanyName(c.name, typedName)) ||
        (typedHost !== "" && hostOf(c.website) === typedHost) ||
        (typedEmail !== "" && (c.mainEmail ?? "").toLowerCase() === typedEmail),
    )
    .slice(0, 5);
}

/**
 * The longest word of a name, minus the legal form.
 *
 * Used only to narrow the scan: the word most likely to survive however the
 * company is written down, and long enough that `%word%` is not the whole table.
 */
function longestWord(name?: string | null): string {
  const words = normalizeCompanyName(name ?? "")
    .split(" ")
    .filter((w) => w.length >= 3);
  return words.reduce((longest, w) => (w.length > longest.length ? w : longest), "");
}

/** The host of a URL, however loosely it was typed. Empty when there isn't one. */
function hostOf(website?: string | null): string {
  const raw = website?.trim().toLowerCase();
  if (!raw) return "";
  const host = raw
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0];
  return host.includes(".") ? host : "";
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
  await db
    .update(leads)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(leads.id, keepId));
  await Promise.all([
    db.update(activities).set({ leadId: keepId }).where(eq(activities.leadId, mergeId)),
    db.update(tasks).set({ leadId: keepId }).where(eq(tasks.leadId, mergeId)),
    db.update(campaignLogs).set({ leadId: keepId }).where(eq(campaignLogs.leadId, mergeId)),
    db.update(tickets).set({ leadId: keepId }).where(eq(tickets.leadId, mergeId)),
    db.update(appointments).set({ leadId: keepId }).where(eq(appointments.leadId, mergeId)),
  ]);
  await db.delete(leads).where(eq(leads.id, mergeId));
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
  await db
    .update(contacts)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(contacts.id, keepId));
  await Promise.all([
    db.update(activities).set({ contactId: keepId }).where(eq(activities.contactId, mergeId)),
    db.update(tasks).set({ contactId: keepId }).where(eq(tasks.contactId, mergeId)),
    db.update(deals).set({ contactId: keepId }).where(eq(deals.contactId, mergeId)),
    db.update(quotes).set({ contactId: keepId }).where(eq(quotes.contactId, mergeId)),
    db.update(tickets).set({ contactId: keepId }).where(eq(tickets.contactId, mergeId)),
    db.update(appointments).set({ contactId: keepId }).where(eq(appointments.contactId, mergeId)),
  ]);
  await db.delete(contacts).where(eq(contacts.id, mergeId));
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
  await db
    .update(companies)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(companies.id, keepId));
  await Promise.all([
    db.update(contacts).set({ companyId: keepId }).where(eq(contacts.companyId, mergeId)),
    db.update(activities).set({ companyId: keepId }).where(eq(activities.companyId, mergeId)),
    db.update(tasks).set({ companyId: keepId }).where(eq(tasks.companyId, mergeId)),
    db.update(deals).set({ companyId: keepId }).where(eq(deals.companyId, mergeId)),
    db.update(quotes).set({ companyId: keepId }).where(eq(quotes.companyId, mergeId)),
    db.update(tickets).set({ companyId: keepId }).where(eq(tickets.companyId, mergeId)),
    db.update(appointments).set({ companyId: keepId }).where(eq(appointments.companyId, mergeId)),
  ]);
  await db.delete(companies).where(eq(companies.id, mergeId));
  revalidatePath("/dashboard/companies");
}

// ─── Paged list queries ───────────────────────────────────────────────────────
//
// The three list screens used to select every column of every row and hand the
// result to a client component: no limit, no paging, no server-side sort, and no
// plain search box (audit rilievi B-08, U-04). At a few thousand records that is
// megabytes of JSON per visit; at a few tens of thousands the page does not open.
//
// Only the columns the table renders are selected, the count comes from the
// database, and the state lives in the URL so a filtered list stays shareable.

/** Concatenated-name match, because "Mario Rossi" is what people type. */
function fullNameMatch(first: AnyPgColumn, last: AnyPgColumn, term: string) {
  return sql`lower(coalesce(${first}, '') || ' ' || coalesce(${last}, '')) LIKE lower(${`%${term}%`})`;
}

/** Digits-only comparison, so "+39 02 1234567" is found by "021234567". */
function phoneMatch(col: AnyPgColumn, term: string) {
  const digits = term.replace(/\D/g, "");
  if (digits.length < 4) return undefined;
  return sql`regexp_replace(coalesce(${col}, ''), '[^0-9]', '', 'g') LIKE ${`%${digits}%`}`;
}

/** Combines the saved filter tree with the free-text search box. */
async function listWhere(
  db: Awaited<ReturnType<typeof getDb>>,
  params: ListParams,
  entityType: "lead" | "contact" | "company",
  idCol: AnyPgColumn,
  baseFields: Record<string, unknown>,
  searchClause: SQL | undefined,
): Promise<SQL | undefined> {
  const tree = params.filter ? decodeFilter(params.filter) : null;

  let filterClause: SQL | undefined;
  if (tree) {
    const customDefs = await db
      .select()
      .from(customFieldDefinitions)
      .where(eq(customFieldDefinitions.entityType, entityType));
    const registry = { ...baseFields, ...customFieldsToRegistry(customDefs) } as never;
    filterClause = buildWhereClause(tree, registry, idCol);
  }

  if (filterClause && searchClause) return and(filterClause, searchClause);
  return filterClause ?? searchClause;
}

const LEAD_SORTS: Record<string, AnyPgColumn> = {
  firstName: leads.firstName,
  lastName: leads.lastName,
  email: leads.email,
  companyName: leads.companyName,
  status: leads.status,
  leadScore: leads.leadScore,
  createdAt: leads.createdAt,
};

const CONTACT_SORTS: Record<string, AnyPgColumn> = {
  firstName: contacts.firstName,
  lastName: contacts.lastName,
  email: contacts.email,
  jobTitle: contacts.jobTitle,
  city: contacts.city,
  status: contacts.status,
  leadScore: contacts.leadScore,
  createdAt: contacts.createdAt,
};

const COMPANY_SORTS: Record<string, AnyPgColumn> = {
  name: companies.name,
  industry: companies.industry,
  city: companies.city,
  status: companies.status,
  createdAt: companies.createdAt,
};

function orderFor(sorts: Record<string, AnyPgColumn>, params: ListParams, fallback: AnyPgColumn) {
  const col = params.sort ? sorts[params.sort] : undefined;
  if (!col) return desc(fallback);
  return params.dir === "asc" ? asc(col) : desc(col);
}

/** One page of leads, with the total that matches the query. */
export async function listLeads(params: ListParams) {
  const db = await getDb();
  const term = params.search;

  const search = term
    ? or(
        ilike(leads.firstName, `%${term}%`),
        ilike(leads.lastName, `%${term}%`),
        fullNameMatch(leads.firstName, leads.lastName, term),
        ilike(leads.email, `%${term}%`),
        ilike(leads.companyName, `%${term}%`),
        phoneMatch(leads.phone, term),
        phoneMatch(leads.mobile, term),
      )
    : undefined;

  const where = await listWhere(db, params, "lead", leads.id, LEAD_FIELDS, search);

  const [rows, [counted]] = await Promise.all([
    db
      .select({
        id: leads.id,
        firstName: leads.firstName,
        lastName: leads.lastName,
        email: leads.email,
        phone: leads.phone,
        companyName: leads.companyName,
        city: leads.city,
        status: leads.status,
        rating: leads.rating,
        leadScore: leads.leadScore,
        isConverted: leads.isConverted,
        createdAt: leads.createdAt,
        ownerId: leads.ownerId,
        ownerName: users.name,
      })
      .from(leads)
      .leftJoin(users, eq(leads.ownerId, users.id))
      .where(where)
      .orderBy(orderFor(LEAD_SORTS, params, leads.createdAt))
      .limit(params.pageSize)
      .offset(offsetOf(params)),
    db.select({ n: count() }).from(leads).where(where),
  ]);

  return toPage(rows, Number(counted?.n ?? 0), params);
}

/** One page of contacts. */
export async function listContacts(params: ListParams) {
  const db = await getDb();
  const term = params.search;

  const search = term
    ? or(
        ilike(contacts.firstName, `%${term}%`),
        ilike(contacts.lastName, `%${term}%`),
        fullNameMatch(contacts.firstName, contacts.lastName, term),
        ilike(contacts.email, `%${term}%`),
        phoneMatch(contacts.phone, term),
        phoneMatch(contacts.mobile, term),
      )
    : undefined;

  const where = await listWhere(db, params, "contact", contacts.id, CONTACT_FIELDS, search);

  const [rows, [counted]] = await Promise.all([
    db
      .select({
        id: contacts.id,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        email: contacts.email,
        phone: contacts.phone,
        jobTitle: contacts.jobTitle,
        city: contacts.city,
        status: contacts.status,
        leadScore: contacts.leadScore,
        createdAt: contacts.createdAt,
        ownerId: contacts.ownerId,
        ownerName: users.name,
      })
      .from(contacts)
      .leftJoin(users, eq(contacts.ownerId, users.id))
      .where(where)
      .orderBy(orderFor(CONTACT_SORTS, params, contacts.createdAt))
      .limit(params.pageSize)
      .offset(offsetOf(params)),
    db.select({ n: count() }).from(contacts).where(where),
  ]);

  return toPage(rows, Number(counted?.n ?? 0), params);
}

/** One page of companies. */
export async function listCompanies(params: ListParams) {
  const db = await getDb();
  const term = params.search;

  const search = term
    ? or(
        ilike(companies.name, `%${term}%`),
        ilike(companies.industry, `%${term}%`),
        ilike(companies.vatNumber, `%${term}%`),
        ilike(companies.mainEmail, `%${term}%`),
        phoneMatch(companies.mainPhone, term),
      )
    : undefined;

  const where = await listWhere(db, params, "company", companies.id, COMPANY_FIELDS, search);

  const [rows, [counted]] = await Promise.all([
    db
      .select({
        id: companies.id,
        name: companies.name,
        industry: companies.industry,
        city: companies.city,
        country: companies.country,
        website: companies.website,
        employeeCount: companies.employeeCount,
        mainPhone: companies.mainPhone,
        mainEmail: companies.mainEmail,
        status: companies.status,
        type: companies.type,
        createdAt: companies.createdAt,
        ownerId: companies.ownerId,
        ownerName: users.name,
      })
      .from(companies)
      .leftJoin(users, eq(companies.ownerId, users.id))
      .where(where)
      .orderBy(orderFor(COMPANY_SORTS, params, companies.createdAt))
      .limit(params.pageSize)
      .offset(offsetOf(params)),
    db.select({ n: count() }).from(companies).where(where),
  ]);

  return toPage(rows, Number(counted?.n ?? 0), params);
}

export type LeadRow = Awaited<ReturnType<typeof listLeads>>["rows"][number];
export type ContactRow = Awaited<ReturnType<typeof listContacts>>["rows"][number];
export type CompanyRow = Awaited<ReturnType<typeof listCompanies>>["rows"][number];
