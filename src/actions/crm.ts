"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { and, asc, count, desc, eq, getTableColumns, ilike, inArray, isNull, ne, or, type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn, AnyPgTable } from "drizzle-orm/pg-core";
import { getTranslations } from "next-intl/server";

import {
  CompanySchema,
  CompanyUpdateSchema,
  ContactSchema,
  ContactUpdateSchema,
  definedOnly,
  LeadSchema,
  LeadUpdateSchema,
} from "@/actions/crm-validation";
import { runAutomations } from "@/components/crm/automation/rule-engine";
import {
  activities,
  appointments,
  companies,
  companyCategories,
  companyTypes,
  contacts,
  customFieldDefinitions,
  customFieldValues,
  deals,
  documents,
  leads,
  pipelineStages,
  tasks,
  tickets,
  users,
} from "@/db/schema";
import { requireCapability, requirePlanLimit, requireWriteAccess } from "@/lib/auth-guard";
import { companiesWithAccounts } from "@/lib/company-accounts";
import { isSameCompanyName, normalizeCompanyName } from "@/lib/company-name";
import { type ConsentSource, consentPatch } from "@/lib/consent";
import { announceOptOut } from "@/lib/consent-events";
import { contactReach } from "@/lib/contact-reach";
import { recordFieldChanges } from "@/lib/field-history";
import {
  buildWhereClause,
  COMPANY_FIELDS,
  CONTACT_FIELDS,
  customFieldsToRegistry,
  LEAD_FIELDS,
} from "@/lib/filter-engine";
import { decodeFilter } from "@/lib/filter-types";
import { guardedT, serverT } from "@/lib/i18n-server";
import { announceLeadAssignment } from "@/lib/lead-assignment";
import { computeLeadScore } from "@/lib/lead-score";
import { COMPANY_CHILDREN, CONTACT_CHILDREN, childColumn, LEAD_CHILDREN, type MergeChild } from "@/lib/merge-children";
import { notify } from "@/lib/notify";
import { type ListParams, offsetOf, toPage } from "@/lib/pagination";
import { resolvePipelineId } from "@/lib/pipelines";
import { countRecords } from "@/lib/record-count";
import { assertCanSee, ownerOnCreate, recordScope, visibleIds, visibleWhere } from "@/lib/record-visibility";
import { getDb } from "@/lib/tenant-context";
import { matchesText } from "@/lib/text-match";
import { dispatchWebhook } from "@/lib/webhook-dispatch";

// ── Company lookup tables ──────────────────────────────────────────────────────

export async function getCompanyCategories() {
  await requireCapability("record:read");
  const db = await getDb();
  return db
    .select({ id: companyCategories.id, name: companyCategories.name })
    .from(companyCategories)
    .orderBy(companyCategories.name);
}

export async function getCompanyTypes() {
  await requireCapability("record:read");
  const db = await getDb();
  return db.select({ id: companyTypes.id, name: companyTypes.name }).from(companyTypes).orderBy(companyTypes.name);
}

/**
 * A category or type typed into the company form. ⚠️ One that already exists under other
 * capitals is that one: the unique index is case-sensitive, and "Prospect" beside
 * "prospect" split every report grouped by it (Settings → Lists merges old pairs).
 */
async function findOrCreateListEntry(table: typeof companyCategories | typeof companyTypes, name: string) {
  const db = await getDb();
  const clean = name.trim();
  const [existing] = await db
    .select({ id: table.id, name: table.name })
    .from(table)
    .where(sql`lower(${table.name}) = ${clean.toLowerCase()}`)
    .limit(1);
  if (existing) return existing;
  const [row] = await db.insert(table).values({ name: clean }).returning({ id: table.id, name: table.name });
  revalidatePath("/dashboard/companies");
  return row;
}

export async function createCompanyCategory(name: string) {
  await requireWriteAccess();
  return findOrCreateListEntry(companyCategories, name);
}

export async function createCompanyType(name: string) {
  await requireWriteAccess();
  return findOrCreateListEntry(companyTypes, name);
}

// ── Users ─────────────────────────────────────────────────────────────────────
export async function getAllUsers() {
  await requireCapability("record:read");
  const db = await getDb();
  return db.select({ id: users.id, name: users.name, email: users.email }).from(users).orderBy(users.name);
}

// ─── Record-limit helper ──────────────────────────────────────────────────────

// LEADS
export async function getLeads(encodedFilter?: string | null) {
  await requireCapability("record:read");
  const db = await getDb();
  const tree = encodedFilter ? decodeFilter(encodedFilter) : null;
  const scope = visibleWhere("lead", await recordScope());
  const base = db
    .select({ ...getTableColumns(leads), ownerName: users.name })
    .from(leads)
    .leftJoin(users, eq(leads.ownerId, users.id));
  if (!tree) return base.where(scope).orderBy(desc(leads.createdAt));
  const customDefs = await db
    .select()
    .from(customFieldDefinitions)
    .where(eq(customFieldDefinitions.entityType, "lead"));
  const registry = { ...LEAD_FIELDS, ...customFieldsToRegistry(customDefs) };
  const where = buildWhereClause(tree, registry, leads.id);
  return base.where(and(where, scope)).orderBy(desc(leads.createdAt));
}

/**
 * The most recently created leads, for the dashboard.
 *
 * The dashboard used to call `getLeads()` — every lead, every column — sort them
 * in JavaScript and keep five (audit rilievo B-08).
 */
export async function getRecentLeads(limit = 5) {
  await requireCapability("record:read");
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
    .where(and(eq(leads.isConverted, false), visibleWhere("lead", await recordScope())))
    .orderBy(desc(leads.createdAt))
    .limit(limit);
}

// CONTACTS
export async function getContacts(encodedFilter?: string | null) {
  await requireCapability("record:read");
  const db = await getDb();
  const tree = encodedFilter ? decodeFilter(encodedFilter) : null;
  const scope = visibleWhere("contact", await recordScope());
  const base = db
    .select({ ...getTableColumns(contacts), ownerName: users.name })
    .from(contacts)
    .leftJoin(users, eq(contacts.ownerId, users.id));
  if (!tree) return base.where(scope).orderBy(desc(contacts.createdAt));
  const customDefs = await db
    .select()
    .from(customFieldDefinitions)
    .where(eq(customFieldDefinitions.entityType, "contact"));
  const registry = { ...CONTACT_FIELDS, ...customFieldsToRegistry(customDefs) };
  const where = buildWhereClause(tree, registry, contacts.id);
  return base.where(and(where, scope)).orderBy(desc(contacts.createdAt));
}

export async function createLead(data: unknown) {
  return guardedT(async () => {
    const actor = await requireWriteAccess();
    const db = await getDb();
    // Validated with the same schema the form uses, so a bad value is a message
    // on the field rather than a Postgres error naming a column (rilievo M-08).
    // What a salesperson creates for nobody is theirs (src/lib/record-visibility.ts).
    const validated = ownerOnCreate(await recordScope(), LeadSchema.parse(data));
    await requirePlanLimit("maxRecords", await countRecords(db));
    const payload = {
      ...validated,
      // Dated and sourced as a decision taken here (src/lib/consent.ts).
      ...consentPatch(null, validated.marketingConsent, "form", new Date(), validated.consentDate),
      leadScore: computeLeadScore(validated),
    };
    const [newLead] = await db.insert(leads).values(payload).returning();
    // Created already assigned — to a colleague or to a group: they are told.
    await announceLeadAssignment(db, {
      leadId: newLead.id,
      name: `${newLead.firstName ?? ""} ${newLead.lastName ?? ""}`,
      before: null,
      after: newLead,
      actorId: actor.user.id,
    });
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
  return guardedT(async () => {
    const actor = await requireWriteAccess();
    await assertCanSee("lead", id);
    const db = await getDb();
    // Validated with the same schema the form uses, so a bad value is a message
    // on the field rather than a Postgres error naming a column (rilievo M-08).
    const validated = definedOnly(LeadUpdateSchema.parse(data));
    // Read before the write: the automation engine compares old and new to
    // decide whether a field `changed`, and cannot do that after the fact.
    const [previous] = await db.select().from(leads).where(eq(leads.id, id));
    const payload = {
      ...validated,
      // A consent that changes here is a decision taken today, in a form (src/lib/consent.ts).
      ...consentPatch(previous, validated.marketingConsent, "form", new Date(), validated.consentDate),
      // ⚠️ Scored on the whole lead, not on the fields sent. The form sends every
      // field so it never showed, but a partial update — `{ status }` from the
      // detail page's qualification path — scored only the status and wiped the
      // points earned by the email, the phone, the rating and the rest.
      leadScore: computeLeadScore({ ...(previous ?? {}), ...validated }),
    };
    const [updatedLead] = await db.update(leads).set(payload).where(eq(leads.id, id)).returning();
    await recordFieldChanges(db, "lead", id, previous, updatedLead, actor.user.id);
    // A new owner or a new group is told; whoever made the change is not.
    await announceLeadAssignment(db, {
      leadId: id,
      name: `${updatedLead.firstName ?? ""} ${updatedLead.lastName ?? ""}`,
      before: previous ?? null,
      after: updatedLead,
      actorId: actor.user.id,
    });
    // Withdrawn here, from the record: every system that writes to them hears it.
    if (previous?.marketingConsent === true && updatedLead.marketingConsent === false) {
      await announceOptOut(
        db,
        { records: [{ entity: "lead", id }], source: "form", channel: "marketing" },
        { via: "user", actor: actor.user.id },
      );
    }
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
  await assertCanSee("lead", id);
  const db = await getDb();
  await db.delete(leads).where(eq(leads.id, id));
  revalidatePath("/dashboard/leads");
}

/**
 * How a lead is converted, as chosen in the dialog. Every field is optional: the API and older
 * callers convert into the first pipeline, with a company only when the lead names one.
 */
export interface ConvertLeadOptions {
  /** The pipeline the deal opens in; its first open stage. Absent: the first pipeline. */
  pipelineId?: string | null;
  /**
   * A private customer: with no company on the lead, the customer is filed under a company in
   * the person's own name, because a quote and an invoice are made out to a company (S4).
   */
  privateCustomer?: boolean;
}

export async function convertLead(leadId: string, shouldCreateDeal: boolean, options: ConvertLeadOptions = {}) {
  const actor = await requireWriteAccess();
  await assertCanSee("lead", leadId);
  const db = await getDb();
  await requirePlanLimit("maxRecords", await countRecords(db));

  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId));
  if (!lead) throw new Error("Lead not found");
  if (lead.isConverted) throw new Error("Lead is already converted");

  const tLeads = await getTranslations("leads");
  const dealName = tLeads("dealForName", { firstName: lead.firstName, lastName: lead.lastName });
  // ⚠️ The same agent on every record the lead becomes; a lead nobody owned becomes the
  // converter's, as anything they create for nobody does (src/lib/record-visibility.ts).
  const ownerId = lead.ownerId ?? actor.user.id;
  const personName = [lead.firstName, lead.lastName].filter(Boolean).join(" ").trim();

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

  // The same person converted twice is one contact: the duplicate check existed in this very
  // file and was never called from here.
  const duplicate = lead.email
    ? (
        await db
          .select({ id: contacts.id, companyId: contacts.companyId })
          .from(contacts)
          .where(eq(contacts.email, lead.email))
          .limit(1)
      )[0]
    : undefined;

  // 1. Create or find Company.
  //
  // Matching on the exact name is why "ACME Srl" and "Acme S.r.l." became two
  // companies. A normalised comparison catches the ordinary variations; the VAT
  // number catches the rest, and is the only truly reliable key.
  let companyId: string | null = null;
  if (!lead.companyName && options.privateCustomer) {
    // ⚠️⚠️ A private customer is filed under a company in their own name: quotes require one,
    // and an invoice is made out to it. Never matched by name — two people called Mario Rossi
    // are two customers — but the company the same person already has is theirs again.
    if (duplicate?.companyId) {
      companyId = duplicate.companyId;
    } else {
      companyId = crypto.randomUUID();
      writes.push(
        db.insert(companies).values({
          id: companyId,
          name: personName || lead.email || dealName,
          // A person, not a business: the e-invoice names them with <Nome> and <Cognome>.
          personFirstName: lead.firstName || undefined,
          personLastName: lead.lastName || undefined,
          mainEmail: lead.email ?? undefined,
          mainPhone: lead.mobile ?? lead.phone ?? undefined,
          street: lead.street ?? undefined,
          city: lead.city ?? undefined,
          state: lead.state ?? undefined,
          zipCode: lead.zipCode ?? undefined,
          country: lead.country ?? undefined,
          source: lead.source ?? undefined,
          ownerId,
          groupId: lead.groupId ?? undefined,
          sourceLeadId: lead.id,
        }),
      );
    }
  } else if (lead.companyName) {
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
          ownerId,
          groupId: lead.groupId ?? undefined,
          sourceLeadId: lead.id,
          companyTypeId: lead.leadTypeId ?? undefined,
          companyCategoryId: lead.leadCategoryId ?? undefined,
        }),
      );
    }
  }

  // 2. Create Contact from full lead profile, unless the person is one already (above).
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
        ownerId,
        groupId: lead.groupId ?? undefined,
        companyId: companyId ?? undefined,
        // The lead's decision, with its own date and source: converting is not consenting.
        marketingConsent: lead.marketingConsent,
        consentDate: lead.consentDate ?? undefined,
        consentSource: (lead.consentSource as ConsentSource | null) ?? undefined,
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
    // The first open stage of the pipeline chosen (the first pipeline when none was): a lead
    // converts into new business, never straight into a won or lost column.
    const [firstStage] = await db
      .select({ id: pipelineStages.id, probability: pipelineStages.defaultProbability })
      .from(pipelineStages)
      .where(
        and(
          eq(pipelineStages.pipelineId, await resolvePipelineId(db, options.pipelineId ?? null)),
          eq(pipelineStages.isWon, false),
          eq(pipelineStages.isLost, false),
        ),
      )
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
        probability: firstStage.probability ?? undefined,
        companyId: companyId ?? undefined,
        contactId,
        ownerId,
        groupId: lead.groupId ?? undefined,
        // ⚠️⚠️ Where the customer came from travels to the sale: without it a deal can be
        // counted by nothing but its lead (S1, migration 0073).
        source: lead.source ?? undefined,
        status: "open",
      }),
    );
  }

  // 6b. Appointments and documents follow the person: on the lead's page they were the
  // visit booked and the papers collected, and after conversion that page is closed.
  writes.push(
    db
      .update(appointments)
      .set({
        leadId: null,
        contactId: sql`coalesce(${appointments.contactId}, ${contactId})`,
        companyId: sql`coalesce(${appointments.companyId}, ${companyId})`,
        dealId: sql`coalesce(${appointments.dealId}, ${dealId})`,
      })
      .where(eq(appointments.leadId, leadId)),
  );
  writes.push(
    db
      .update(documents)
      .set(dealId ? { entityType: "deal", entityId: dealId } : { entityType: "contact", entityId: contactId })
      .where(and(eq(documents.entityType, "lead"), eq(documents.entityId, leadId))),
  );

  // 6c. Custom fields carry over where the contact or the deal has a field of the same name and
  // kind (its slug): "Tipo di intervento" typed on the lead is not typed again on the deal.
  writes.push(...(await carryCustomFields(db, leadId, { contact: duplicate ? null : contactId, deal: dealId })));

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

  // ⚠️⚠️ **Who this is about, not just which rows moved.** The payload used to carry ids
  // only, and ours mean nothing outside this database: a subscriber heard "a lead was
  // converted" and could not tell **which person**, so it dropped the fact. The VoipAI
  // assistant, which delivers and chases the quote this salesperson is about to write, never
  // learned that the trattativa had started — measured on its side on 2026-09-16, where the
  // event was discarded for having no recapito. Same `contactReach` as every quote and deal
  // event: the telephone number and the email are what both sides already know.
  const reach = await contactReach(db, result.contactId);
  dispatchWebhook("lead.converted", {
    leadId,
    contactId: result.contactId,
    companyId: result.companyId,
    dealId: result.dealId,
    ...reach,
    // biome-ignore lint/suspicious/noEmptyBlockStatements: fire-and-forget
  }).catch(() => {});

  revalidatePath("/dashboard/leads");
  revalidatePath("/dashboard/contacts");
  revalidatePath("/dashboard/companies");
  revalidatePath("/dashboard/pipeline");

  // The same rules as the same records made by hand: a deal created, a lead that changed.
  after(async () => {
    if (dealId) {
      const [deal] = await db.select().from(deals).where(eq(deals.id, dealId));
      if (deal) {
        await runAutomations({
          entityType: "deal",
          entityId: dealId,
          event: "onCreate",
          oldData: {},
          newData: deal as Record<string, unknown>,
          currentUserId: actor.user.id,
        });
      }
    }
    const [converted] = await db.select().from(leads).where(eq(leads.id, leadId));
    if (converted) {
      await runAutomations({
        entityType: "lead",
        entityId: leadId,
        event: "onUpdate",
        oldData: lead as Record<string, unknown>,
        newData: converted as Record<string, unknown>,
        currentUserId: actor.user.id,
      });
    }
  });

  return result;
}

/**
 * The inserts that copy a lead's custom field values onto the contact and the deal it becomes:
 * a field is the same when its slug and its kind are. Read now, written with the conversion.
 *
 * ⚠️ A contact that already existed keeps its own values (`contact: null`): the conversion of
 * a lead must not overwrite what is known about a customer.
 */
async function carryCustomFields(
  db: Awaited<ReturnType<typeof getDb>>,
  leadId: string,
  targets: { contact: string | null; deal: string | null },
) {
  const kinds = (["contact", "deal"] as const).filter((k) => targets[k]);
  if (kinds.length === 0) return [];
  const values = await db
    .select({
      slug: customFieldDefinitions.slug,
      type: customFieldDefinitions.fieldType,
      value: customFieldValues.value,
    })
    .from(customFieldValues)
    .innerJoin(customFieldDefinitions, eq(customFieldDefinitions.id, customFieldValues.fieldId))
    .where(and(eq(customFieldValues.entityType, "lead"), eq(customFieldValues.entityId, leadId)));
  const filled = values.filter((v) => v.value !== null && v.value !== "");
  if (filled.length === 0) return [];
  const fields = await db
    .select({
      id: customFieldDefinitions.id,
      entityType: customFieldDefinitions.entityType,
      slug: customFieldDefinitions.slug,
      type: customFieldDefinitions.fieldType,
    })
    .from(customFieldDefinitions)
    .where(inArray(customFieldDefinitions.entityType, [...kinds]));
  const rows = kinds.flatMap((kind) =>
    filled.flatMap((v) => {
      const field = fields.find((f) => f.entityType === kind && f.slug === v.slug && f.type === v.type);
      return field ? [{ fieldId: field.id, entityType: kind, entityId: targets[kind] as string, value: v.value }] : [];
    }),
  );
  return rows.length ? [db.insert(customFieldValues).values(rows)] : [];
}

export async function createContact(data: unknown) {
  return guardedT(async () => {
    await requireWriteAccess();
    const db = await getDb();
    // Validated with the same schema the form uses, so a bad value is a message
    // on the field rather than a Postgres error naming a column (rilievo M-08).
    // What a salesperson creates for nobody is theirs (src/lib/record-visibility.ts).
    const validated = ownerOnCreate(await recordScope(), ContactSchema.parse(data));
    await requirePlanLimit("maxRecords", await countRecords(db));
    const payload = {
      ...validated,
      ...consentPatch(null, validated.marketingConsent, "form", new Date(), validated.consentDate),
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
  return guardedT(async () => {
    const actor = await requireWriteAccess();
    await assertCanSee("contact", id);
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
        notify({
          userId: validated.ownerId,
          type: "lead_assigned",
          key: "contactAssigned",
          params: { name: `${cur.firstName} ${cur.lastName}`.trim() },
          link: `/dashboard/contacts/${id}`,
          // biome-ignore lint/suspicious/noEmptyBlockStatements: fire-and-forget
        }).catch(() => {});
      }
    }
    const payload = {
      ...validated,
      ...consentPatch(previous, validated.marketingConsent, "form", new Date(), validated.consentDate),
      leadScore: computeLeadScore(validated),
    };
    const [updatedContact] = await db.update(contacts).set(payload).where(eq(contacts.id, id)).returning();
    await recordFieldChanges(db, "contact", id, previous, updatedContact, actor.user.id);
    // Withdrawn here, from the record: every system that writes to them hears it.
    if (previous?.marketingConsent === true && updatedContact.marketingConsent === false) {
      await announceOptOut(
        db,
        { records: [{ entity: "contact", id }], source: "form", channel: "marketing" },
        { via: "user", actor: actor.user.id },
      );
    }
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
  await assertCanSee("contact", id);
  const db = await getDb();
  await db.delete(contacts).where(eq(contacts.id, id));
  revalidatePath("/dashboard/contacts");
  // biome-ignore lint/suspicious/noEmptyBlockStatements: fire-and-forget
  dispatchWebhook("contact.deleted", { id }).catch(() => {});
}

// COMPANIES
export async function getCompanies(encodedFilter?: string | null) {
  await requireCapability("record:read");
  const db = await getDb();
  const tree = encodedFilter ? decodeFilter(encodedFilter) : null;
  const scope = visibleWhere("company", await recordScope());
  const base = db
    .select({ ...getTableColumns(companies), ownerName: users.name })
    .from(companies)
    .leftJoin(users, eq(companies.ownerId, users.id));
  if (!tree) return base.where(scope).orderBy(desc(companies.createdAt));
  const customDefs = await db
    .select()
    .from(customFieldDefinitions)
    .where(eq(customFieldDefinitions.entityType, "company"));
  const registry = { ...COMPANY_FIELDS, ...customFieldsToRegistry(customDefs) };
  const where = buildWhereClause(tree, registry, companies.id);
  return base.where(and(where, scope)).orderBy(desc(companies.createdAt));
}

export async function createCompany(data: unknown) {
  return guardedT(async () => {
    await requireWriteAccess();
    const db = await getDb();
    // Validated with the same schema the form uses, so a bad value is a message
    // on the field rather than a Postgres error naming a column (rilievo M-08).
    // What a salesperson creates for nobody is theirs (src/lib/record-visibility.ts).
    const validated = ownerOnCreate(await recordScope(), CompanySchema.parse(data));
    await requirePlanLimit("maxRecords", await countRecords(db));
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
  return guardedT(async () => {
    const actor = await requireWriteAccess();
    await assertCanSee("company", id);
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
        notify({
          userId: validated.ownerId,
          type: "lead_assigned",
          key: "companyAssigned",
          params: { name: cur.name },
          link: `/dashboard/companies/${id}`,
          // biome-ignore lint/suspicious/noEmptyBlockStatements: fire-and-forget
        }).catch(() => {});
      }
    }
    const payload = { ...validated };
    const [updatedCompany] = await db.update(companies).set(payload).where(eq(companies.id, id)).returning();
    await recordFieldChanges(db, "company", id, previous, updatedCompany, actor.user.id);
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

export async function deleteCompany(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireWriteAccess();
  await assertCanSee("company", id);
  const db = await getDb();
  // A customer with invoices or payments is merged, never deleted (src/lib/company-accounts.ts).
  if ((await companiesWithAccounts(db, [id])).size > 0)
    return { ok: false, error: (await serverT("serverErrors.companies"))("hasAccounts") };

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
  return { ok: true };
}

// ── Lightweight lists for FK select dropdowns ─────────────────────────────────

export async function getContactsForSelect() {
  await requireCapability("record:read");
  const db = await getDb();
  return db
    .select({
      id: contacts.id,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      email: contacts.email,
      // A picker beside a company one narrows to that company's people with it.
      companyId: contacts.companyId,
    })
    .from(contacts)
    .where(visibleWhere("contact", await recordScope()))
    .orderBy(contacts.firstName, contacts.lastName);
}

export async function getCompaniesForSelect() {
  await requireCapability("record:read");
  const db = await getDb();
  return db
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(visibleWhere("company", await recordScope()))
    .orderBy(companies.name);
}

export async function getLeadsForSelect() {
  await requireCapability("record:read");
  const db = await getDb();
  return db
    .select({ id: leads.id, firstName: leads.firstName, lastName: leads.lastName, email: leads.email })
    .from(leads)
    .where(visibleWhere("lead", await recordScope()))
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
    conditions.push(and(matchesText(leads.firstName, firstName.trim()), matchesText(leads.lastName, lastName.trim())));
  }
  if (!conditions.length) return [];

  // biome-ignore lint/style/noNonNullAssertion: or() returns SQL when conditions array is non-empty (guard above)
  const base = or(...conditions)!;
  const where = excludeId ? and(base, ne(leads.id, excludeId)) : base;

  const found = await db
    .select({
      id: leads.id,
      firstName: leads.firstName,
      lastName: leads.lastName,
      email: leads.email,
      phone: leads.phone,
      ownerName: users.name,
    })
    .from(leads)
    .leftJoin(users, eq(leads.ownerId, users.id))
    .where(where)
    .limit(5);
  return maskHidden(db, "lead", found, (r) => ({ ...r, firstName: "", lastName: "", email: null, phone: null }));
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
    conditions.push(
      and(matchesText(contacts.firstName, firstName.trim()), matchesText(contacts.lastName, lastName.trim())),
    );
  }
  if (!conditions.length) return [];

  // biome-ignore lint/style/noNonNullAssertion: or() returns SQL when conditions array is non-empty (guard above)
  const base = or(...conditions)!;
  const where = excludeId ? and(base, ne(contacts.id, excludeId)) : base;

  const found = await db
    .select({
      id: contacts.id,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      email: contacts.email,
      phone: contacts.phone,
      ownerName: users.name,
    })
    .from(contacts)
    .leftJoin(users, eq(contacts.ownerId, users.id))
    .where(where)
    .limit(5);
  return maskHidden(db, "contact", found, (r) => ({ ...r, firstName: "", lastName: "", email: null, phone: null }));
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
  if (anchor) conditions.push(matchesText(companies.name, `%${anchor}%`));
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
      ownerName: users.name,
    })
    .from(companies)
    .leftJoin(users, eq(companies.ownerId, users.id))
    .where(where)
    .limit(40);

  const typedName = name?.trim() ?? "";
  const typedHost = hostOf(website);
  const typedEmail = mainEmail?.trim().toLowerCase() ?? "";

  const matches = candidates
    .filter(
      (c) =>
        (typedName !== "" && isSameCompanyName(c.name, typedName)) ||
        (typedHost !== "" && hostOf(c.website) === typedHost) ||
        (typedEmail !== "" && (c.mainEmail ?? "").toLowerCase() === typedEmail),
    )
    .slice(0, 5);
  return maskHidden(db, "company", matches, (r) => ({ ...r, name: "", mainEmail: null, website: null }));
}

/**
 * A duplicate the person may not open is still said to exist — creating a second record of a
 * colleague's customer is exactly what must not happen — with whose it is, and nothing else: no
 * name, address or number, which would hand the customer over through the warning.
 */
async function maskHidden<T extends { id: string; ownerName: string | null }>(
  db: Awaited<ReturnType<typeof getDb>>,
  kind: "lead" | "contact" | "company",
  rows: T[],
  blank: (row: T) => T,
): Promise<(T & { restricted: boolean })[]> {
  const scope = await recordScope();
  const seen = await visibleIds(
    db,
    kind,
    rows.map((r) => r.id),
    scope,
  );
  return rows.map((r) => (seen.has(r.id) ? { ...r, restricted: false } : { ...blank(r), restricted: true }));
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
  await assertCanSee("lead", id);
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
  await Promise.all([assertCanSee("lead", keepId), assertCanSee("lead", mergeId)]);
  const db = await getDb();
  await mergeRecords(db, { table: leads, id: leads.id }, LEAD_CHILDREN, keepId, mergeId, fields);
  revalidatePath("/dashboard/leads");
}

export async function getContactForMerge(id: string) {
  await requireWriteAccess();
  await assertCanSee("contact", id);
  const db = await getDb();
  return db.query.contacts.findFirst({
    where: eq(contacts.id, id),
    with: { company: { columns: { id: true, name: true } } },
  });
}

export async function getCompanyForMerge(id: string) {
  await requireWriteAccess();
  await assertCanSee("company", id);
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
  await Promise.all([assertCanSee("contact", keepId), assertCanSee("contact", mergeId)]);
  const db = await getDb();
  await mergeRecords(db, { table: contacts, id: contacts.id }, CONTACT_CHILDREN, keepId, mergeId, fields);
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
  fiscalCode?: string | null;
  pec?: string | null;
  linkedinUrl?: string | null;
  source?: string | null;
  ownerId?: string | null;
};

/**
 * One merge, as one commit.
 *
 * Everything that pointed at the losing record is carried across and the loser is
 * deleted, in a single ordered statement list. `db.transaction()` throws on the
 * Neon HTTP driver; `db.batch()` maps to its transaction endpoint, and nowhere
 * else in the codebase does that matter as much: the last statement is a delete,
 * so half a merge means rows still pointing at a record that is on its way out —
 * and the foreign keys that cascade would take them with it (audit rilievo M-04).
 *
 * What to carry is not written here. It comes from `@/lib/merge-children`, which
 * a test compares against the foreign keys in the schema, because the hand-written
 * version of this list quietly fell behind the tables it was supposed to describe.
 */
async function mergeRecords(
  db: Awaited<ReturnType<typeof getDb>>,
  parent: { table: AnyPgTable; id: AnyPgColumn },
  children: MergeChild[],
  keepId: string,
  mergeId: string,
  fields: Record<string, unknown>,
) {
  type Update = ReturnType<typeof db.update>;
  const writes: unknown[] = [
    (db.update(parent.table as never) as Update).set({ ...fields, updatedAt: new Date() }).where(eq(parent.id, keepId)),
    ...children.flatMap((child) => {
      const moved = (db.update(child.table as never) as Update)
        .set({ [child.field]: keepId })
        .where(eq(childColumn(child), mergeId));
      if (!child.collidesOn) return [moved];
      const key = childColumn({ table: child.table, field: child.collidesOn });
      const survivors = db
        .select({ key })
        .from(child.table as never)
        .where(eq(childColumn(child), keepId));
      return [
        db.delete(child.table as never).where(and(eq(childColumn(child), mergeId), inArray(key, survivors))),
        moved,
      ];
    }),
    db.delete(parent.table as never).where(eq(parent.id, mergeId)),
  ];
  await db.batch(writes as unknown as Parameters<typeof db.batch>[0]);
}

export async function mergeCompanies(keepId: string, mergeId: string, fields: CompanyMergeFields) {
  await requireWriteAccess();
  await Promise.all([assertCanSee("company", keepId), assertCanSee("company", mergeId)]);
  const db = await getDb();
  await mergeRecords(db, { table: companies, id: companies.id }, COMPANY_CHILDREN, keepId, mergeId, fields);
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
  return matchesText(sql`coalesce(${first}, '') || ' ' || coalesce(${last}, '')`, `%${term}%`);
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
  // Only what the person may see is listed, counted and searched (src/lib/record-visibility.ts).
  const visible = visibleWhere(entityType, await recordScope());

  let filterClause: SQL | undefined;
  if (tree) {
    const customDefs = await db
      .select()
      .from(customFieldDefinitions)
      .where(eq(customFieldDefinitions.entityType, entityType));
    const registry = { ...baseFields, ...customFieldsToRegistry(customDefs) } as never;
    filterClause = buildWhereClause(tree, registry, idCol);
  }

  return and(filterClause, searchClause, visible);
}

const LEAD_SORTS: Record<string, AnyPgColumn> = {
  firstName: leads.firstName,
  lastName: leads.lastName,
  email: leads.email,
  companyName: leads.companyName,
  city: leads.city,
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
  employeeCount: companies.employeeCount,
  createdAt: companies.createdAt,
};

function orderFor(sorts: Record<string, AnyPgColumn>, params: ListParams, fallback: AnyPgColumn) {
  const col = params.sort ? sorts[params.sort] : undefined;
  if (!col) return desc(fallback);
  return params.dir === "asc" ? asc(col) : desc(col);
}

/** One page of leads, with the total that matches the query. */
export async function listLeads(params: ListParams) {
  await requireCapability("record:read");
  const db = await getDb();
  const term = params.search;

  const search = term
    ? or(
        matchesText(leads.firstName, `%${term}%`),
        matchesText(leads.lastName, `%${term}%`),
        fullNameMatch(leads.firstName, leads.lastName, term),
        ilike(leads.email, `%${term}%`),
        matchesText(leads.companyName, `%${term}%`),
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
  await requireCapability("record:read");
  const db = await getDb();
  const term = params.search;

  const search = term
    ? or(
        matchesText(contacts.firstName, `%${term}%`),
        matchesText(contacts.lastName, `%${term}%`),
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
  await requireCapability("record:read");
  const db = await getDb();
  const term = params.search;

  const search = term
    ? or(
        matchesText(companies.name, `%${term}%`),
        matchesText(companies.industry, `%${term}%`),
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
