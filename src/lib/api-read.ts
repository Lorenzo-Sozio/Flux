/**
 * The read half of the API (L9): contacts, leads, companies, deals and orders, a page at a
 * time, oldest change first, with `updatedSince` for reconciling.
 *
 * ⚠️⚠️ **The cursor is the row's own timestamp, as Postgres wrote it.** Pages are cut on
 * (updated_at, id). A JavaScript Date holds milliseconds and Postgres microseconds, so a
 * cursor made from a Date would sit *before* the row it came from and serve it again — and
 * a page full of rows sharing one millisecond would serve the same page for ever. The
 * cursor therefore carries `updated_at::text` and compares it back as a timestamp.
 *
 * ⚠️ **What each entity shows is a list, not a row.** A new column is not API until it is
 * added here on purpose: internal fields (`health_score`, `group_id`) never leak by the
 * accident of existing.
 *
 * ⚠️ A deleted record is simply absent. Reconciliation sees what is there; what went away is
 * told by the `*.deleted` webhooks.
 */
import { and, asc, eq, gt, gte, or, sql } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";

import { companies, contacts, deals, leads, orders, pipelineStages, pipelines, products } from "@/db/schema";

// biome-ignore lint/suspicious/noExplicitAny: platform and tenant handles share the query builders
type AnyDb = NeonHttpDatabase<any>;

export const LIST_DEFAULT = 50;
export const LIST_MAX = 200;

export type ReadableEntity = "contacts" | "leads" | "companies" | "deals" | "orders" | "products";

export interface ListQuery {
  limit: number;
  after: { at: string; id: string } | null;
  updatedSince: Date | null;
}

export type ParsedListQuery = { ok: true; query: ListQuery } | { ok: false; field: string; error: string };

const CURSOR_AT = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?$/;

export function encodeCursor(at: string, id: string): string {
  return Buffer.from(JSON.stringify([at, id])).toString("base64url");
}

export function decodeCursor(cursor: string): { at: string; id: string } | null {
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!Array.isArray(value) || value.length !== 2) return null;
    const [at, id] = value;
    // Checked for shape, because it is compared inside SQL — as a parameter, but still.
    if (typeof at !== "string" || !CURSOR_AT.test(at) || typeof id !== "string" || id.length > 100) return null;
    return { at, id };
  } catch {
    return null;
  }
}

export function parseListQuery(params: URLSearchParams): ParsedListQuery {
  const rawLimit = params.get("limit");
  let limit = LIST_DEFAULT;
  if (rawLimit !== null) {
    limit = Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > LIST_MAX) {
      return { ok: false, field: "limit", error: `limit must be a whole number from 1 to ${LIST_MAX}` };
    }
  }
  const rawCursor = params.get("cursor");
  const after = rawCursor ? decodeCursor(rawCursor) : null;
  if (rawCursor && !after) return { ok: false, field: "cursor", error: "cursor is not one this API returned" };
  const rawSince = params.get("updatedSince");
  let updatedSince: Date | null = null;
  if (rawSince) {
    updatedSince = new Date(rawSince);
    if (Number.isNaN(updatedSince.getTime()) || !/^\d{4}-\d{2}-\d{2}/.test(rawSince)) {
      return { ok: false, field: "updatedSince", error: "updatedSince must be an ISO 8601 date or date-time" };
    }
  }
  return { ok: true, query: { limit, after, updatedSince } };
}

// ─── What each entity shows ──────────────────────────────────────────────────

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v === null || v === undefined ? null : String(v));

type Row = Record<string, unknown>;

// biome-ignore lint/suspicious/noExplicitAny: each entity's own table and columns
const READERS: Record<
  ReadableEntity,
  { table: any; select: Record<string, any>; join?: (q: any) => any; shape: (r: Row) => Row }
> = {
  contacts: {
    table: contacts,
    select: {
      id: contacts.id,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      email: contacts.email,
      phone: contacts.phone,
      mobile: contacts.mobile,
      jobTitle: contacts.jobTitle,
      department: contacts.department,
      companyId: contacts.companyId,
      ownerId: contacts.ownerId,
      status: contacts.status,
      source: contacts.source,
      street: contacts.street,
      city: contacts.city,
      state: contacts.state,
      zipCode: contacts.zipCode,
      country: contacts.country,
      linkedinUrl: contacts.linkedinUrl,
      tags: contacts.tags,
      marketingConsent: contacts.marketingConsent,
      createdAt: contacts.createdAt,
      updatedAt: contacts.updatedAt,
    },
    shape: (r) => ({ ...r, createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt) }),
  },
  leads: {
    table: leads,
    select: {
      id: leads.id,
      firstName: leads.firstName,
      lastName: leads.lastName,
      email: leads.email,
      phone: leads.phone,
      mobile: leads.mobile,
      jobTitle: leads.jobTitle,
      companyName: leads.companyName,
      industry: leads.industry,
      website: leads.website,
      status: leads.status,
      source: leads.source,
      rating: leads.rating,
      ownerId: leads.ownerId,
      city: leads.city,
      country: leads.country,
      tags: leads.tags,
      marketingConsent: leads.marketingConsent,
      isConverted: leads.isConverted,
      convertedToContactId: leads.convertedToContactId,
      convertedToCompanyId: leads.convertedToCompanyId,
      convertedToDealId: leads.convertedToDealId,
      createdAt: leads.createdAt,
      updatedAt: leads.updatedAt,
    },
    shape: (r) => ({ ...r, createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt) }),
  },
  companies: {
    table: companies,
    select: {
      id: companies.id,
      name: companies.name,
      industry: companies.industry,
      website: companies.website,
      type: companies.type,
      status: companies.status,
      source: companies.source,
      mainEmail: companies.mainEmail,
      mainPhone: companies.mainPhone,
      street: companies.street,
      city: companies.city,
      state: companies.state,
      zipCode: companies.zipCode,
      country: companies.country,
      vatNumber: companies.vatNumber,
      fiscalCode: companies.fiscalCode,
      sdiCode: companies.sdiCode,
      pec: companies.pec,
      ownerId: companies.ownerId,
      tags: companies.tags,
      createdAt: companies.createdAt,
      updatedAt: companies.updatedAt,
    },
    shape: (r) => ({ ...r, createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt) }),
  },
  deals: {
    table: deals,
    select: {
      id: deals.id,
      name: deals.name,
      amount: deals.amount,
      currency: deals.currency,
      probability: deals.probability,
      status: deals.status,
      stageId: deals.stageId,
      stageName: pipelineStages.name,
      companyId: deals.companyId,
      contactId: deals.contactId,
      ownerId: deals.ownerId,
      expectedCloseDate: deals.expectedCloseDate,
      closedAt: deals.closedAt,
      lostReason: deals.lostReason,
      createdAt: deals.createdAt,
      updatedAt: deals.updatedAt,
    },
    join: (q) => q.leftJoin(pipelineStages, eq(pipelineStages.id, deals.stageId)),
    shape: (r) => ({
      ...r,
      amount: num(r.amount),
      expectedCloseDate: iso(r.expectedCloseDate),
      closedAt: iso(r.closedAt),
      createdAt: iso(r.createdAt),
      updatedAt: iso(r.updatedAt),
    }),
  },
  products: {
    table: products,
    select: {
      id: products.id,
      sku: products.sku,
      name: products.name,
      description: products.description,
      price: products.price,
      taxPercent: products.taxPercent,
      unit: products.unit,
      category: products.category,
      isActive: products.isActive,
      createdAt: products.createdAt,
      updatedAt: products.updatedAt,
    },
    shape: (r) => ({
      ...r,
      price: num(r.price),
      taxPercent: num(r.taxPercent),
      createdAt: iso(r.createdAt),
      updatedAt: iso(r.updatedAt),
    }),
  },
  orders: {
    table: orders,
    select: {
      id: orders.id,
      orderNumber: orders.orderNumber,
      status: orders.status,
      companyId: orders.companyId,
      contactId: orders.contactId,
      dealId: orders.dealId,
      quoteId: orders.quoteId,
      ownerId: orders.ownerId,
      currency: orders.currency,
      subtotal: orders.subtotal,
      discountAmount: orders.discountAmount,
      taxAmount: orders.taxAmount,
      totalAmount: orders.totalAmount,
      source: orders.source,
      orderDate: orders.orderDate,
      deliveredAt: orders.deliveredAt,
      createdAt: orders.createdAt,
      updatedAt: orders.updatedAt,
    },
    shape: (r) => ({
      ...r,
      subtotal: num(r.subtotal),
      discountAmount: num(r.discountAmount),
      taxAmount: num(r.taxAmount),
      totalAmount: num(r.totalAmount),
      orderDate: iso(r.orderDate),
      deliveredAt: iso(r.deliveredAt),
      createdAt: iso(r.createdAt),
      updatedAt: iso(r.updatedAt),
    }),
  },
};

export interface ListPage {
  data: Row[];
  /** Pass back as `cursor` for the next page; null when this was the last. */
  nextCursor: string | null;
}

export async function listEntity(db: AnyDb, entity: ReadableEntity, query: ListQuery): Promise<ListPage> {
  const reader = READERS[entity];
  const t = reader.table;
  const conditions = [];
  if (query.updatedSince) conditions.push(gte(t.updatedAt, query.updatedSince));
  if (query.after) {
    const at = sql`${query.after.at}::timestamp`;
    conditions.push(or(gt(t.updatedAt, at), and(eq(t.updatedAt, at), gt(t.id, query.after.id))));
  }
  let q = db
    .select({ ...reader.select, _at: sql<string>`${t.updatedAt}::text` })
    .from(t)
    .$dynamic();
  if (reader.join) q = reader.join(q);
  const rows: Row[] = await q
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(t.updatedAt), asc(t.id))
    .limit(query.limit + 1);

  const more = rows.length > query.limit;
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    data: page.map(({ _at, ...r }) => reader.shape(r)),
    nextCursor: more && last ? encodeCursor(String(last._at), String(last.id)) : null,
  };
}

/**
 * The pipelines and their stages, in board order — what an integration needs to move a deal
 * or a lead to the stage *this* workspace calls «qualified», instead of a word it hardcoded.
 * Not paginated: a workspace has a handful of each.
 */
export async function listPipelineStages(db: AnyDb) {
  const [allPipelines, allStages] = await Promise.all([
    db
      .select({ id: pipelines.id, name: pipelines.name, order: pipelines.order })
      .from(pipelines)
      .orderBy(asc(pipelines.order)),
    db
      .select({
        id: pipelineStages.id,
        name: pipelineStages.name,
        order: pipelineStages.order,
        pipelineId: pipelineStages.pipelineId,
        probability: pipelineStages.defaultProbability,
        isWon: pipelineStages.isWon,
        isLost: pipelineStages.isLost,
        staleAfterDays: pipelineStages.staleAfterDays,
      })
      .from(pipelineStages)
      .orderBy(asc(pipelineStages.order)),
  ]);
  return allPipelines.map((p: { id: string; name: string; order: number }) => ({
    ...p,
    stages: allStages
      .filter((st: { pipelineId: string }) => st.pipelineId === p.id)
      .map(({ pipelineId: _p, isWon, isLost, ...st }: Row & { isWon: boolean; isLost: boolean }) => ({
        ...st,
        kind: isWon ? "won" : isLost ? "lost" : "open",
      })),
  }));
}
