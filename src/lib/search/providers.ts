import { and, desc, eq, ilike, or, type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import {
  appointments,
  companies,
  contacts,
  contracts,
  deals,
  documents,
  emailSequences,
  emailTemplates,
  invoices,
  leads,
  marketingCampaigns,
  orders,
  priceLists,
  products,
  quotes,
  tasks,
  tickets,
} from "@/db/schema";
import { DOCUMENT_PARENT_TYPES, type EntityType, entityHref } from "@/lib/entities";

/**
 * How each kind of record is searched. One function per entity in
 * src/lib/entities.ts, and `entities.test.ts` fails when one is missing — which
 * is what "a new section is searchable" has to mean.
 *
 * A hit carries `status` and `amount` as data rather than as a sentence, so the
 * dialog can put them in the reader's language.
 */

export interface SearchHit {
  id: string;
  type: EntityType;
  label: string;
  sub: string | null;
  /** A status code the client translates, when the entity has one. */
  status?: string | null;
  amount?: { value: string; currency: string } | null;
  url: string;
}

// biome-ignore lint/suspicious/noExplicitAny: a tenant handle from getDb
type Db = any;

export interface SearchTerms {
  like: string;
  /** Digits of the query when it has at least four, for phone numbers. */
  phoneLike: string | null;
}

export const PER_ENTITY = 5;

const fullName = (first: AnyPgColumn, last: AnyPgColumn, like: string) =>
  sql`lower(coalesce(${first}, '') || ' ' || coalesce(${last}, '')) LIKE lower(${like})`;

const phone = (col: AnyPgColumn, phoneLike: string | null) =>
  phoneLike ? sql`regexp_replace(coalesce(${col}, ''), '[^0-9]', '', 'g') LIKE ${phoneLike}` : undefined;

const name = (first: string | null, last: string | null) => `${first ?? ""} ${last ?? ""}`.trim();

type Provider = (db: Db, t: SearchTerms) => Promise<SearchHit[]>;

export const SEARCH_PROVIDERS: Record<EntityType, Provider> = {
  async lead(db, { like, phoneLike }) {
    const rows = await db
      .select({
        id: leads.id,
        first: leads.firstName,
        last: leads.lastName,
        email: leads.email,
        company: leads.companyName,
        status: leads.status,
      })
      .from(leads)
      .where(
        or(
          ilike(leads.firstName, like),
          ilike(leads.lastName, like),
          fullName(leads.firstName, leads.lastName, like),
          ilike(leads.email, like),
          ilike(leads.companyName, like),
          phone(leads.phone, phoneLike),
          phone(leads.mobile, phoneLike),
        ),
      )
      .orderBy(desc(leads.updatedAt))
      .limit(PER_ENTITY);
    return rows.map(
      (r: {
        id: string;
        first: string;
        last: string;
        email: string | null;
        company: string | null;
        status: string;
      }) => ({
        id: r.id,
        type: "lead",
        label: name(r.first, r.last) || r.email || r.id,
        sub: r.company ?? r.email,
        status: r.status,
        url: entityHref("lead", r.id),
      }),
    );
  },

  async contact(db, { like, phoneLike }) {
    const rows = await db
      .select({
        id: contacts.id,
        first: contacts.firstName,
        last: contacts.lastName,
        email: contacts.email,
        company: companies.name,
      })
      .from(contacts)
      .leftJoin(companies, eq(companies.id, contacts.companyId))
      .where(
        or(
          ilike(contacts.firstName, like),
          ilike(contacts.lastName, like),
          fullName(contacts.firstName, contacts.lastName, like),
          ilike(contacts.email, like),
          phone(contacts.phone, phoneLike),
          phone(contacts.mobile, phoneLike),
        ),
      )
      .orderBy(desc(contacts.updatedAt))
      .limit(PER_ENTITY);
    return rows.map((r: { id: string; first: string; last: string; email: string | null; company: string | null }) => ({
      id: r.id,
      type: "contact",
      label: name(r.first, r.last) || r.email || r.id,
      sub: [r.company, r.email].filter(Boolean).join(" · ") || null,
      url: entityHref("contact", r.id),
    }));
  },

  async company(db, { like, phoneLike }) {
    const rows = await db
      .select({ id: companies.id, name: companies.name, city: companies.city, industry: companies.industry })
      .from(companies)
      .where(
        or(
          ilike(companies.name, like),
          ilike(companies.industry, like),
          ilike(companies.vatNumber, like),
          ilike(companies.fiscalCode, like),
          ilike(companies.mainEmail, like),
          phone(companies.mainPhone, phoneLike),
        ),
      )
      .orderBy(desc(companies.updatedAt))
      .limit(PER_ENTITY);
    return rows.map((r: { id: string; name: string; city: string | null; industry: string | null }) => ({
      id: r.id,
      type: "company",
      label: r.name,
      sub: [r.industry, r.city].filter(Boolean).join(" · ") || null,
      url: entityHref("company", r.id),
    }));
  },

  async deal(db, { like }) {
    const rows = await db
      .select({
        id: deals.id,
        name: deals.name,
        status: deals.status,
        amount: deals.amount,
        currency: deals.currency,
        company: companies.name,
      })
      .from(deals)
      .leftJoin(companies, eq(companies.id, deals.companyId))
      .where(or(ilike(deals.name, like), ilike(companies.name, like)))
      .orderBy(desc(deals.updatedAt))
      .limit(PER_ENTITY);
    return rows.map(
      (r: {
        id: string;
        name: string;
        status: string;
        amount: string | null;
        currency: string;
        company: string | null;
      }) => ({
        id: r.id,
        type: "deal",
        label: r.name,
        sub: r.company,
        status: r.status,
        amount: r.amount ? { value: r.amount, currency: r.currency } : null,
        url: entityHref("deal", r.id),
      }),
    );
  },

  async product(db, { like }) {
    const rows = await db
      .select({ id: products.id, name: products.name, sku: products.sku, category: products.category })
      .from(products)
      .where(or(ilike(products.name, like), ilike(products.sku, like), ilike(products.category, like)))
      .orderBy(products.name)
      .limit(PER_ENTITY);
    return rows.map((r: { id: string; name: string; sku: string | null; category: string | null }) => ({
      id: r.id,
      type: "product",
      label: r.name,
      sub: [r.sku, r.category].filter(Boolean).join(" · ") || null,
      url: entityHref("product", r.id, r.name),
    }));
  },

  /**
   * ⚠️ `sub` is the percentage as a signed figure, not a sentence: this runs on
   * the server, where the reader's language is not the one to guess at, and the
   * sign is the whole meaning — negative takes money off, positive adds it.
   */
  async priceList(db, { like }) {
    const rows = await db
      .select({
        id: priceLists.id,
        name: priceLists.name,
        description: priceLists.description,
        adjustmentPercent: priceLists.adjustmentPercent,
      })
      .from(priceLists)
      .where(or(ilike(priceLists.name, like), ilike(priceLists.description, like)))
      .orderBy(priceLists.name)
      .limit(PER_ENTITY);
    return rows.map((r: { id: string; name: string; description: string | null; adjustmentPercent: string }) => {
      const percent = Number(r.adjustmentPercent);
      return {
        id: r.id,
        type: "priceList",
        label: r.name,
        sub: percent === 0 ? r.description : `${percent > 0 ? "+" : ""}${percent}%`,
        url: entityHref("priceList", r.id),
      };
    });
  },

  async quote(db, { like }) {
    const rows = await db
      .select({
        id: quotes.id,
        number: quotes.quoteNumber,
        status: quotes.status,
        total: quotes.totalAmount,
        currency: quotes.currency,
        company: companies.name,
      })
      .from(quotes)
      .leftJoin(companies, eq(companies.id, quotes.companyId))
      .where(or(ilike(quotes.quoteNumber, like), ilike(companies.name, like)))
      .orderBy(desc(quotes.createdAt))
      .limit(PER_ENTITY);
    return rows.map(
      (r: { id: string; number: string; status: string; total: string; currency: string; company: string | null }) => ({
        id: r.id,
        type: "quote",
        label: r.number,
        sub: r.company,
        status: r.status,
        amount: { value: r.total, currency: r.currency },
        url: entityHref("quote", r.id),
      }),
    );
  },

  async order(db, { like }) {
    const rows = await db
      .select({
        id: orders.id,
        number: orders.orderNumber,
        status: orders.status,
        total: orders.totalAmount,
        currency: orders.currency,
        company: companies.name,
      })
      .from(orders)
      .leftJoin(companies, eq(companies.id, orders.companyId))
      .where(or(ilike(orders.orderNumber, like), ilike(companies.name, like)))
      .orderBy(desc(orders.createdAt))
      .limit(PER_ENTITY);
    return rows.map(
      (r: { id: string; number: string; status: string; total: string; currency: string; company: string | null }) => ({
        id: r.id,
        type: "order",
        label: r.number,
        sub: r.company,
        status: r.status,
        amount: { value: r.total, currency: r.currency },
        url: entityHref("order", r.id),
      }),
    );
  },

  async contract(db, { like }) {
    const rows = await db
      .select({
        id: contracts.id,
        title: contracts.title,
        status: contracts.status,
        amount: contracts.amount,
        currency: contracts.currency,
        company: companies.name,
      })
      .from(contracts)
      .leftJoin(companies, eq(companies.id, contracts.companyId))
      .where(or(ilike(contracts.title, like), ilike(companies.name, like)))
      .orderBy(desc(contracts.createdAt))
      .limit(PER_ENTITY);
    return rows.map(
      (r: { id: string; title: string; status: string; amount: string; currency: string; company: string | null }) => ({
        id: r.id,
        type: "contract",
        label: r.title,
        sub: r.company,
        status: r.status,
        amount: { value: r.amount, currency: r.currency },
        url: entityHref("contract", r.id),
      }),
    );
  },

  invoice: (db, t) => searchInvoices(db, t, "TD01"),
  creditNote: (db, t) => searchInvoices(db, t, "TD04"),

  async ticket(db, { like }) {
    const rows = await db
      .select({ id: tickets.id, number: tickets.ticketNumber, subject: tickets.subject, status: tickets.status })
      .from(tickets)
      .where(or(ilike(tickets.subject, like), ilike(tickets.ticketNumber, like)))
      .orderBy(desc(tickets.createdAt))
      .limit(PER_ENTITY);
    return rows.map((r: { id: string; number: string; subject: string; status: string }) => ({
      id: r.id,
      type: "ticket",
      label: r.subject,
      sub: r.number,
      status: r.status,
      url: entityHref("ticket", r.id),
    }));
  },

  async task(db, { like }) {
    const rows = await db
      .select({ id: tasks.id, title: tasks.title, status: tasks.status, due: tasks.dueDate })
      .from(tasks)
      .where(or(ilike(tasks.title, like), ilike(tasks.description, like)))
      .orderBy(desc(tasks.createdAt))
      .limit(PER_ENTITY);
    return rows.map((r: { id: string; title: string; status: string; due: Date | null }) => ({
      id: r.id,
      type: "task",
      label: r.title,
      sub: r.due ? new Date(r.due).toISOString().slice(0, 10) : null,
      status: r.status,
      url: entityHref("task", r.id),
    }));
  },

  async appointment(db, { like }) {
    const rows = await db
      .select({
        id: appointments.id,
        title: appointments.title,
        start: appointments.startAt,
        location: appointments.location,
      })
      .from(appointments)
      .where(
        or(ilike(appointments.title, like), ilike(appointments.location, like), ilike(appointments.description, like)),
      )
      .orderBy(desc(appointments.startAt))
      .limit(PER_ENTITY);
    return rows.map((r: { id: string; title: string; start: Date; location: string | null }) => ({
      id: r.id,
      type: "appointment",
      label: r.title,
      sub: [new Date(r.start).toISOString().slice(0, 10), r.location].filter(Boolean).join(" · "),
      url: entityHref("appointment", r.id),
    }));
  },

  async campaign(db, { like }) {
    const rows = await db
      .select({ id: marketingCampaigns.id, name: marketingCampaigns.name, status: marketingCampaigns.status })
      .from(marketingCampaigns)
      .where(or(ilike(marketingCampaigns.name, like), ilike(marketingCampaigns.description, like)))
      .orderBy(desc(marketingCampaigns.createdAt))
      .limit(PER_ENTITY);
    return rows.map((r: { id: string; name: string; status: string }) => ({
      id: r.id,
      type: "campaign",
      label: r.name,
      sub: null,
      status: r.status,
      url: entityHref("campaign", r.id),
    }));
  },

  async sequence(db, { like }) {
    const rows = await db
      .select({ id: emailSequences.id, name: emailSequences.name, description: emailSequences.description })
      .from(emailSequences)
      .where(or(ilike(emailSequences.name, like), ilike(emailSequences.description, like)))
      .orderBy(desc(emailSequences.createdAt))
      .limit(PER_ENTITY);
    return rows.map((r: { id: string; name: string; description: string | null }) => ({
      id: r.id,
      type: "sequence",
      label: r.name,
      sub: r.description,
      url: entityHref("sequence", r.id),
    }));
  },

  async template(db, { like }) {
    const rows = await db
      .select({ id: emailTemplates.id, name: emailTemplates.name, subject: emailTemplates.subject })
      .from(emailTemplates)
      .where(or(ilike(emailTemplates.name, like), ilike(emailTemplates.subject, like)))
      .orderBy(emailTemplates.name)
      .limit(PER_ENTITY);
    return rows.map((r: { id: string; name: string; subject: string }) => ({
      id: r.id,
      type: "template",
      label: r.name,
      sub: r.subject,
      url: entityHref("template", r.id, r.name),
    }));
  },

  async document(db, { like }) {
    const rows = await db
      .select({
        id: documents.id,
        name: documents.name,
        entityType: documents.entityType,
        entityId: documents.entityId,
      })
      .from(documents)
      .where(ilike(documents.name, like))
      .orderBy(desc(documents.createdAt))
      .limit(PER_ENTITY);
    // A document is opened on the record it belongs to; one attached to nothing
    // that has a page is not a useful result.
    return rows
      .filter(
        (r: { entityType: string | null; entityId: string | null }) =>
          r.entityType && r.entityId && DOCUMENT_PARENT_TYPES[r.entityType],
      )
      .map((r: { id: string; name: string; entityType: string; entityId: string }) => ({
        id: r.id,
        type: "document",
        label: r.name,
        sub: null,
        status: r.entityType,
        url: entityHref(DOCUMENT_PARENT_TYPES[r.entityType], r.entityId),
      }));
  },
};

async function searchInvoices(db: Db, { like }: SearchTerms, documentType: "TD01" | "TD04"): Promise<SearchHit[]> {
  const where: SQL | undefined = and(
    eq(invoices.documentType, documentType),
    or(ilike(invoices.documentNumber, like), ilike(companies.name, like), ilike(invoices.notes, like)),
  );
  const rows = await db
    .select({
      id: invoices.id,
      number: invoices.documentNumber,
      status: invoices.status,
      total: invoices.total,
      currency: invoices.currency,
      company: companies.name,
      issueDate: invoices.issueDate,
    })
    .from(invoices)
    .leftJoin(companies, eq(companies.id, invoices.companyId))
    .where(where)
    .orderBy(desc(invoices.createdAt))
    .limit(PER_ENTITY);
  const type = documentType === "TD04" ? "creditNote" : "invoice";
  return rows.map(
    (r: {
      id: string;
      number: string | null;
      status: string;
      total: string;
      currency: string;
      company: string | null;
      issueDate: string | null;
    }) => ({
      id: r.id,
      type,
      // A draft has no number yet: the customer is what identifies it.
      label: r.number ?? r.company ?? r.id.slice(0, 8),
      sub: [r.number ? r.company : null, r.issueDate].filter(Boolean).join(" · ") || null,
      status: r.status,
      amount: { value: r.total, currency: r.currency },
      url: entityHref(type, r.id),
    }),
  );
}
