"use server";

import { revalidatePath } from "next/cache";

import { and, asc, desc, eq, gte, sql } from "drizzle-orm";

import { companies, invoiceIssuers, invoiceItems, invoices, orderItems, orders, products } from "@/db/schema";
import { requireCapability, requirePlanModule } from "@/lib/auth-guard";
import { addDays } from "@/lib/contract-terms";
import { computeDocument } from "@/lib/document-totals";
import { customerGaps, type Gap, issuerGaps } from "@/lib/fiscal-ids";
import { cleanDraft, customerSnapshot, type DraftInput, italianToday, linesFromOrder } from "@/lib/invoice-draft";
import { issueInvoice } from "@/lib/invoice-issue";
import { type DraftLine, type DraftProblem, draftProblems, invoiceScope, suggestsStampDuty } from "@/lib/invoice-rules";
import { tolerateUnmigrated } from "@/lib/schema-ready";
import { getDb } from "@/lib/tenant-context";

const LIST = "/dashboard/sales/invoices";
type Db = Awaited<ReturnType<typeof getDb>>;

function toDraftLines(items: (typeof invoiceItems.$inferSelect)[]): DraftLine[] {
  return items.map((i) => ({
    description: i.description,
    quantity: Number(i.quantity),
    unitPrice: Number(i.unitPrice),
    discountPercent: Number(i.discountPercent),
    taxPercent: Number(i.taxPercent),
    nature: i.nature,
  }));
}

async function writeLines(db: Db, invoiceId: string, lines: DraftInput["lines"]) {
  if (lines.length) {
    // Upsert by position, then remove the tail: no transaction on this driver, and
    // stopping between the two leaves extra lines on a draft, never an empty one.
    await db
      .insert(invoiceItems)
      .values(
        lines.map((l, position) => ({
          invoiceId,
          position,
          productId: l.productId ?? null,
          description: l.description,
          quantity: String(l.quantity),
          unitPrice: String(l.unitPrice),
          discountPercent: String(l.discountPercent ?? 0),
          taxPercent: String(l.taxPercent),
          nature: l.nature ?? null,
        })),
      )
      .onConflictDoUpdate({
        target: [invoiceItems.invoiceId, invoiceItems.position],
        set: {
          productId: sqlExcluded("product_id"),
          description: sqlExcluded("description"),
          quantity: sqlExcluded("quantity"),
          unitPrice: sqlExcluded("unit_price"),
          discountPercent: sqlExcluded("discount_percent"),
          taxPercent: sqlExcluded("tax_percent"),
          nature: sqlExcluded("nature"),
        },
      });
  }
  await db
    .delete(invoiceItems)
    .where(and(eq(invoiceItems.invoiceId, invoiceId), gte(invoiceItems.position, lines.length)));
}

function totalsOf(lines: DraftLine[], discountPercent: number) {
  const t = computeDocument({ lines, discountPercent });
  return {
    subtotal: t.subtotal,
    discountAmount: t.discountAmount,
    taxableAmount: t.taxableAmount,
    taxAmount: t.taxAmount,
    total: t.total,
  };
}

// ─── Reading ──────────────────────────────────────────────────────────────────

export async function getInvoices() {
  await requireCapability("record:read");
  await requirePlanModule("sales");
  const db = await getDb();
  return tolerateUnmigrated(
    "invoices",
    () =>
      db
        .select({
          id: invoices.id,
          documentType: invoices.documentType,
          status: invoices.status,
          documentNumber: invoices.documentNumber,
          issueDate: invoices.issueDate,
          total: invoices.total,
          currency: invoices.currency,
          companyName: companies.name,
          createdAt: invoices.createdAt,
        })
        .from(invoices)
        .leftJoin(companies, eq(companies.id, invoices.companyId))
        .orderBy(asc(invoices.status), desc(invoices.issueDate), desc(invoices.createdAt))
        .limit(500),
    [],
  );
}

export type IssueBlockers = { issuer: Gap[]; customer: Gap[]; draft: DraftProblem[] };

export async function getInvoice(id: string) {
  await requireCapability("record:read");
  await requirePlanModule("sales");
  const db = await getDb();
  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id));
  if (!invoice) return null;
  const [items, [company], [issuer]] = await Promise.all([
    db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, id)).orderBy(asc(invoiceItems.position)),
    invoice.companyId ? db.select().from(companies).where(eq(companies.id, invoice.companyId)) : Promise.resolve([]),
    db.select().from(invoiceIssuers).where(eq(invoiceIssuers.id, "workspace")),
  ]);
  const lines = toDraftLines(items);
  const discount = Number(invoice.discountPercent);
  const blockers: IssueBlockers = {
    issuer: issuerGaps(issuer ?? {}),
    customer: company ? customerGaps({ ...company, province: company.state }) : [{ field: "name", problem: "missing" }],
    draft: draftProblems(lines, discount),
  };
  return {
    invoice,
    items,
    companyName: company?.name ?? null,
    blockers,
    stampDutySuggested: suggestsStampDuty(lines, discount),
    totals: computeDocument({ lines, discountPercent: discount }),
  };
}

// ─── Drafts ───────────────────────────────────────────────────────────────────

/** A draft from an order; an existing draft for that order is returned rather than duplicated. */
export async function createInvoiceFromOrder(
  orderId: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const actor = await requireCapability("invoice:write");
  await requirePlanModule("sales");
  const db = await getDb();

  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) return { ok: false, error: "This order no longer exists." };
  if (!order.companyId) return { ok: false, error: "An invoice needs the order to have a company." };

  const [existing] = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(and(eq(invoices.orderId, orderId), eq(invoices.status, "draft"), eq(invoices.documentType, "TD01")));
  if (existing) return { ok: true, id: existing.id };

  const items = await db
    .select({
      productId: orderItems.productId,
      description: orderItems.description,
      productName: products.name,
      quantity: orderItems.quantity,
      unitPrice: orderItems.unitPrice,
      discountPercent: orderItems.discountPercent,
      taxPercent: orderItems.taxPercent,
    })
    .from(orderItems)
    .leftJoin(products, eq(products.id, orderItems.productId))
    .where(eq(orderItems.orderId, orderId));
  if (items.length === 0) return { ok: false, error: "This order has no lines to invoice." };

  const lines = linesFromOrder(items);
  const discountPercent = Number(order.discountPercent ?? 0);
  const totals = totalsOf(lines, discountPercent);
  const [row] = await db
    .insert(invoices)
    .values({
      documentType: "TD01",
      orderId,
      companyId: order.companyId,
      currency: order.currency,
      discountPercent: String(discountPercent),
      dueDate: addDays(italianToday(), 30),
      subtotal: String(totals.subtotal),
      discountAmount: String(totals.discountAmount),
      taxableAmount: String(totals.taxableAmount),
      taxAmount: String(totals.taxAmount),
      total: String(totals.total),
      stampDuty: suggestsStampDuty(lines, discountPercent),
      createdBy: actor.userId,
    })
    .returning({ id: invoices.id });
  await writeLines(db, row.id, lines);
  revalidatePath(LIST);
  return { ok: true, id: row.id };
}

/**
 * Saves a draft at the revision the editor loaded.
 *
 * ⚠️ The revision is bumped first and conditionally: an edit that arrives after the
 * invoice was issued, or after somebody else saved, changes nothing.
 */
export async function saveInvoiceDraft(
  id: string,
  revision: number,
  input: DraftInput,
): Promise<{ ok: true; revision: number } | { ok: false; error: string }> {
  await requireCapability("invoice:write");
  await requirePlanModule("sales");
  const cleaned = cleanDraft(input);
  if (!cleaned.ok) return cleaned;
  const { lines, ...header } = cleaned.value;
  const db = await getDb();

  const totals = totalsOf(lines, header.discountPercent);
  const [bumped] = await db
    .update(invoices)
    .set({
      series: header.series,
      dueDate: header.dueDate,
      discountPercent: String(header.discountPercent),
      stampDuty: header.stampDuty,
      paymentMethod: header.paymentMethod,
      notes: header.notes,
      subtotal: String(totals.subtotal),
      discountAmount: String(totals.discountAmount),
      taxableAmount: String(totals.taxableAmount),
      taxAmount: String(totals.taxAmount),
      total: String(totals.total),
      revision: revision + 1,
      updatedAt: new Date(),
    })
    .where(and(eq(invoices.id, id), eq(invoices.status, "draft"), eq(invoices.revision, revision)))
    .returning({ revision: invoices.revision });
  if (!bumped) return { ok: false, error: "This invoice was issued or changed by someone else. Reload it." };

  await writeLines(db, id, lines);
  revalidatePath(`${LIST}/${id}`);
  return { ok: true, revision: bumped.revision };
}

/** Only a draft can be deleted: an issued invoice is corrected with a credit note. */
export async function deleteInvoiceDraft(id: string): Promise<{ ok: boolean }> {
  await requireCapability("invoice:write");
  await requirePlanModule("sales");
  const db = await getDb();
  const deleted = await db
    .delete(invoices)
    .where(and(eq(invoices.id, id), eq(invoices.status, "draft")))
    .returning({ id: invoices.id });
  revalidatePath(LIST);
  return { ok: deleted.length > 0 };
}

// ─── Issuing ──────────────────────────────────────────────────────────────────

export async function issueInvoiceAction(
  id: string,
  revision: number,
): Promise<{ ok: true; documentNumber: string } | { ok: false; error: string; blockers?: IssueBlockers }> {
  const actor = await requireCapability("invoice:issue");
  await requirePlanModule("sales");
  const db = await getDb();

  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id));
  if (!invoice || invoice.status !== "draft") return { ok: false, error: "This invoice is not a draft any more." };
  if (invoice.revision !== revision) return { ok: false, error: "This draft changed since you opened it. Reload it." };

  const [items, [company], [issuer]] = await Promise.all([
    db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, id)).orderBy(asc(invoiceItems.position)),
    invoice.companyId ? db.select().from(companies).where(eq(companies.id, invoice.companyId)) : Promise.resolve([]),
    db.select().from(invoiceIssuers).where(eq(invoiceIssuers.id, "workspace")),
  ]);
  const lines = toDraftLines(items);
  const discount = Number(invoice.discountPercent);
  const blockers: IssueBlockers = {
    issuer: issuerGaps(issuer ?? {}),
    customer: company ? customerGaps({ ...company, province: company.state }) : [{ field: "name", problem: "missing" }],
    draft: draftProblems(lines, discount),
  };
  if (blockers.issuer.length || blockers.customer.length || blockers.draft.length) {
    return { ok: false, error: "This invoice cannot be issued yet.", blockers };
  }

  const issueDate = italianToday();
  const fiscalYear = Number(issueDate.slice(0, 4));
  const { id: _id, updatedAt: _u, updatedBy: _b, ...issuerFields } = issuer;
  const result = await issueInvoice(db, {
    invoiceId: id,
    revision,
    scope: invoiceScope(invoice.series, fiscalYear),
    series: invoice.series,
    fiscalYear,
    issueDate,
    issuedBy: actor.userId,
    issuerSnapshot: issuerFields,
    customerSnapshot: customerSnapshot(company),
    linesSnapshot: lines,
    totals: totalsOf(lines, discount),
  });
  if (!result) return { ok: false, error: "This invoice was issued or changed in the meantime. Reload it." };

  revalidatePath(LIST);
  revalidatePath(`${LIST}/${id}`);
  return { ok: true, documentNumber: result.documentNumber };
}

/** The value the upsert tried to insert, for the columns it updates on conflict. */
function sqlExcluded(column: string) {
  return sql.raw(`excluded.${column}`);
}
