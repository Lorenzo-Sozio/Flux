"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { and, asc, count, desc, eq, gte, ilike, or, type SQL, sql } from "drizzle-orm";

import { companies, invoiceIssuers, invoiceItems, invoices, orderItems, orders, products } from "@/db/schema";
import { requireCapability, requirePlanModule } from "@/lib/auth-guard";
import { documentLanguage, formatDocumentMoney } from "@/lib/document-language";
import { sendInvoiceCopyEmail } from "@/lib/email";
import { invoiceTotals } from "@/lib/fatturapa/totals";
import { customerGaps, type Gap, issuerGaps } from "@/lib/fiscal-ids";
import { serverT } from "@/lib/i18n-server";
import { archiveInvoice, readInvoiceFile } from "@/lib/invoice-archive";
import { cleanDraft, customerSnapshot, type DraftInput, italianToday, linesFromOrder } from "@/lib/invoice-draft";
import { issueInvoice } from "@/lib/invoice-issue";
import { type DraftLine, type DraftProblem, draftProblems, invoiceScope } from "@/lib/invoice-rules";
import { type ListParams, offsetOf, toPage } from "@/lib/pagination";
import { tolerateUnmigrated } from "@/lib/schema-ready";
import { assessStampDuty, quarterlyStampDuty, quarterOf, type StampMode, withStampRecharge } from "@/lib/stamp-duty";
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

/**
 * The lines an invoice is totalled and frozen with: its own, plus the stamp recharge
 * line when the stamp applies and the issuer recharges it. Decided in one place so
 * the draft screen, the saved totals and the issued snapshot cannot disagree.
 */
function finalLines(lines: DraftLine[], discountPercent: number, mode: string, recharge: boolean) {
  const stamp = assessStampDuty(lines, discountPercent, mode as StampMode);
  const withDescription = lines.map((l) => ({ ...l, description: l.description ?? "" }));
  return { stamp, lines: withStampRecharge(withDescription, stamp.applied, recharge) as DraftLine[] };
}

/**
 * What is left to credit on an issued invoice: its total less what issued credit
 * notes have already given back. Null when the original is missing or not an
 * issued invoice.
 *
 * ⚠️ For the screen and for a readable refusal only. The limit that holds is the
 * one inside the issuing statement, which cannot be raced.
 */
async function creditRoom(db: Db, originalId: string | null) {
  if (!originalId) return null;
  const [original] = await db
    .select({
      id: invoices.id,
      documentNumber: invoices.documentNumber,
      issueDate: invoices.issueDate,
      status: invoices.status,
      documentType: invoices.documentType,
      total: invoices.total,
      creditedAmount: invoices.creditedAmount,
      currency: invoices.currency,
    })
    .from(invoices)
    .where(eq(invoices.id, originalId));
  if (!original || original.status !== "issued" || original.documentType !== "TD01") return null;
  const residual = Math.round((Number(original.total) - Number(original.creditedAmount)) * 100) / 100;
  return { ...original, residual };
}

/**
 * ⚠️ A credit note never recharges stamp duty. The recharge line on an invoice asks
 * the customer for the €2; on a credit note the same line would give it back, and
 * the duty already paid on the invoice is not refunded to anyone.
 */
async function rechargesFor(db: Db, documentType: string): Promise<boolean> {
  return documentType === "TD04" ? false : issuerRecharges(db);
}

async function issuerRecharges(db: Db): Promise<boolean> {
  const [row] = await tolerateUnmigrated(
    "invoice_issuer.recharge_stamp_duty",
    () =>
      db
        .select({ recharge: invoiceIssuers.rechargeStampDuty })
        .from(invoiceIssuers)
        .where(eq(invoiceIssuers.id, "workspace")),
    [],
  );
  return Boolean(row?.recharge);
}

/** The figures SDI checks — see src/lib/fatturapa/totals.ts for why not computeDocument. */
function totalsOf(lines: DraftLine[], discountPercent: number) {
  const t = invoiceTotals(
    lines.map((l) => ({ ...l, description: l.description ?? "" })),
    discountPercent,
  );
  return {
    subtotal: t.subtotal,
    discountAmount: t.discountAmount,
    taxableAmount: t.taxableAmount,
    taxAmount: t.taxAmount,
    total: t.total,
  };
}

// ─── Reading ──────────────────────────────────────────────────────────────────

/**
 * One page of invoices and credit notes, with the total that matches the query.
 *
 * ⚠️ It used to read the first 500 and stop, so invoice 501 existed, was numbered
 * and counted in the stamp duty, and could not be found on the list.
 */
export async function getInvoices(params: ListParams, status = "all") {
  await requireCapability("record:read");
  await requirePlanModule("sales");
  const db = await getDb();

  const term = params.search.trim();
  const clauses: SQL[] = [];
  if (status === "draft" || status === "issued") clauses.push(eq(invoices.status, status));
  if (term) {
    clauses.push(or(ilike(invoices.documentNumber, `%${term}%`), ilike(companies.name, `%${term}%`)) as SQL);
  }
  const where = clauses.length ? and(...clauses) : undefined;

  return tolerateUnmigrated(
    "invoices",
    async () => {
      // The count carries the same join as the rows: the search can match on the customer.
      const [rows, [counted]] = await Promise.all([
        db
          .select({
            id: invoices.id,
            documentType: invoices.documentType,
            status: invoices.status,
            documentNumber: invoices.documentNumber,
            issueDate: invoices.issueDate,
            total: invoices.total,
            creditedAmount: invoices.creditedAmount,
            currency: invoices.currency,
            companyName: companies.name,
            createdAt: invoices.createdAt,
          })
          .from(invoices)
          .leftJoin(companies, eq(companies.id, invoices.companyId))
          .where(where)
          .orderBy(asc(invoices.status), desc(invoices.issueDate), desc(invoices.createdAt))
          .limit(params.pageSize)
          .offset(offsetOf(params)),
        db.select({ n: count() }).from(invoices).leftJoin(companies, eq(companies.id, invoices.companyId)).where(where),
      ]);
      return toPage(rows, Number(counted?.n ?? 0), params);
    },
    toPage([], 0, params),
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
  const isCredit = invoice.documentType === "TD04";
  const recharge = isCredit ? false : Boolean(issuer?.rechargeStampDuty);
  const final = finalLines(lines, discount, invoice.stampDutyMode, recharge);
  const [original, creditNotes] = await Promise.all([
    isCredit ? creditRoom(db, invoice.originalInvoiceId) : Promise.resolve(null),
    isCredit
      ? Promise.resolve([])
      : db
          .select({
            id: invoices.id,
            status: invoices.status,
            documentNumber: invoices.documentNumber,
            issueDate: invoices.issueDate,
            total: invoices.total,
          })
          .from(invoices)
          .where(and(eq(invoices.originalInvoiceId, id), eq(invoices.documentType, "TD04")))
          .orderBy(asc(invoices.createdAt)),
  ]);
  const draftChecks = draftProblems(lines, discount, { mode: invoice.stampDutyMode, note: invoice.stampDutyNote });
  if (isCredit && invoice.status === "draft") {
    if (!original) draftChecks.push({ kind: "credit_without_original" });
    else if (
      invoiceTotals(
        final.lines.map((l) => ({ ...l, description: l.description ?? "" })),
        discount,
      ).total > original.residual
    ) {
      draftChecks.push({ kind: "credit_exceeds_residual" });
    }
  }
  const blockers: IssueBlockers = {
    issuer: issuerGaps(issuer ?? {}),
    customer: company ? customerGaps({ ...company, province: company.state }) : [{ field: "name", problem: "missing" }],
    draft: draftChecks,
  };
  return {
    invoice,
    original,
    creditNotes,
    items,
    companyName: company?.name ?? null,
    customerEmail: company?.mainEmail ?? null,
    blockers,
    stamp: final.stamp,
    rechargeStamp: recharge,
    totals: invoiceTotals(
      final.lines.map((l) => ({ ...l, description: l.description ?? "" })),
      discount,
    ),
  };
}

// ─── Drafts ───────────────────────────────────────────────────────────────────

/**
 * Everything the new-invoice page needs, in one round trip: the customers with the
 * fiscal fields an invoice checks, the orders still to invoice, and the issuer's gaps.
 *
 * ⚠️ An order counts as invoiced once an invoice for it is issued. One with only a
 * draft stays in the list and carries that draft's id, so the page can offer to open
 * it rather than start a second one.
 */
export async function getNewInvoiceData() {
  await requireCapability("invoice:write");
  await requirePlanModule("sales");
  const db = await getDb();
  const [open, companyRows, productRows, [issuer]] = await Promise.all([
    db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        total: orders.totalAmount,
        currency: orders.currency,
        companyId: orders.companyId,
        companyName: companies.name,
        createdAt: orders.createdAt,
        draftId: sql<
          string | null
        >`(SELECT i.id FROM invoice i WHERE i.order_id = ${orders.id} AND i.document_type = 'TD01' AND i.status = 'draft' LIMIT 1)`,
      })
      .from(orders)
      .leftJoin(companies, eq(companies.id, orders.companyId))
      .where(
        and(
          sql`${orders.status} <> 'cancelled'`,
          sql`${orders.companyId} IS NOT NULL`,
          sql`NOT EXISTS (SELECT 1 FROM invoice i WHERE i.order_id = ${orders.id} AND i.document_type = 'TD01' AND i.status = 'issued')`,
        ),
      )
      .orderBy(desc(orders.createdAt))
      .limit(300),
    db
      .select({
        id: companies.id,
        name: companies.name,
        vatNumber: companies.vatNumber,
        fiscalCode: companies.fiscalCode,
        sdiCode: companies.sdiCode,
        pec: companies.pec,
        street: companies.street,
        zipCode: companies.zipCode,
        city: companies.city,
        province: companies.state,
        country: companies.country,
      })
      .from(companies)
      .orderBy(asc(companies.name))
      .limit(2000),
    db
      .select({
        id: products.id,
        name: products.name,
        sku: products.sku,
        price: products.price,
        taxPercent: products.taxPercent,
      })
      .from(products)
      .where(eq(products.isActive, true))
      .orderBy(asc(products.name))
      .limit(2000),
    tolerateUnmigrated(
      "invoice_issuer",
      () => db.select().from(invoiceIssuers).where(eq(invoiceIssuers.id, "workspace")),
      [],
    ),
  ]);
  return {
    orders: open.map((o) => ({ ...o, createdAt: o.createdAt.toISOString().slice(0, 10) })),
    companies: companyRows,
    products: productRows.map((p) => ({ ...p, price: Number(p.price), taxPercent: Number(p.taxPercent ?? 0) })),
    issuerGaps: issuerGaps(issuer ?? {}),
    rechargeStamp: Boolean(issuer?.rechargeStampDuty),
  };
}

/** An order's lines and terms, as the new-invoice page fills them in. */
export async function getOrderForInvoice(orderId: string) {
  await requireCapability("invoice:write");
  await requirePlanModule("sales");
  const db = await getDb();
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) return null;
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
  return {
    companyId: order.companyId,
    currency: order.currency,
    discountPercent: Number(order.discountPercent ?? 0),
    lines: linesFromOrder(items),
  };
}

/**
 * A new invoice, written whole: customer, lines and terms in one call, saved as a draft.
 *
 * The page then issues it with the revision returned here, so "Issue" is one click
 * for the person and still goes through the one statement that assigns numbers.
 */
export async function createInvoice(
  input: DraftInput & { companyId: string; orderId?: string | null; currency?: string },
): Promise<{ ok: true; id: string; revision: number } | { ok: false; error: string; existingId?: string }> {
  const actor = await requireCapability("invoice:write");
  await requirePlanModule("sales");
  const cleaned = cleanDraft(input);
  if (!cleaned.ok) return cleaned;
  const { lines, ...header } = cleaned.value;
  const db = await getDb();

  const [company] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, input.companyId));
  if (!company) return { ok: false, error: (await serverT("serverErrors.invoices"))("chooseCustomer") };

  const orderId = input.orderId || null;
  if (orderId) {
    const [draft] = await db
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.orderId, orderId), eq(invoices.status, "draft"), eq(invoices.documentType, "TD01")));
    if (draft)
      return { ok: false, error: (await serverT("serverErrors.invoices"))("orderHasDraft"), existingId: draft.id };
  }

  const final = finalLines(lines, header.discountPercent, header.stampDutyMode, await issuerRecharges(db));
  const totals = totalsOf(final.lines, header.discountPercent);
  const [row] = await db
    .insert(invoices)
    .values({
      documentType: "TD01",
      orderId,
      companyId: company.id,
      currency: input.currency || "EUR",
      series: header.series,
      dueDate: header.dueDate,
      discountPercent: String(header.discountPercent),
      stampDuty: final.stamp.applied,
      stampDutyMode: header.stampDutyMode,
      stampDutyNote: header.stampDutyNote,
      paymentMethod: header.paymentMethod,
      notes: header.notes,
      subtotal: String(totals.subtotal),
      discountAmount: String(totals.discountAmount),
      taxableAmount: String(totals.taxableAmount),
      taxAmount: String(totals.taxAmount),
      total: String(totals.total),
      createdBy: actor.userId,
    })
    .returning({ id: invoices.id, revision: invoices.revision });
  await writeLines(db, row.id, lines);
  revalidatePath(LIST);
  return { ok: true, id: row.id, revision: row.revision };
}

/**
 * A draft credit note for an issued invoice, with the invoice's lines.
 *
 * "full" copies every line as it was issued, so the note gives back the whole
 * invoice; "partial" copies them too, to be reduced or removed on the draft page.
 * Either way what is issued is checked against what is left to credit.
 *
 * ⚠️ The stamp recharge line is not copied: see `rechargesFor`. The customer is the
 * company as it is now, checked like any invoice's; the series is the invoice's,
 * so the note continues the same numbering unless it is changed on the draft.
 */
export async function createCreditNote(
  invoiceId: string,
  mode: "full" | "partial",
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const actor = await requireCapability("invoice:write");
  await requirePlanModule("sales");
  const db = await getDb();

  const room = await creditRoom(db, invoiceId);
  if (!room) return { ok: false, error: (await serverT("serverErrors.invoices"))("creditOnlyIssued") };
  if (room.residual <= 0) return { ok: false, error: (await serverT("serverErrors.invoices"))("creditedInFull") };
  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));

  const frozen = (
    (invoice.linesSnapshot ?? []) as (DraftLine & { isStampRecharge?: boolean; productId?: string | null })[]
  )
    .filter((l) => !l.isStampRecharge)
    .map((l) => ({
      productId: l.productId ?? null,
      description: l.description ?? "",
      quantity: Number(l.quantity),
      unitPrice: Number(l.unitPrice),
      discountPercent: Number(l.discountPercent ?? 0),
      taxPercent: Number(l.taxPercent),
      nature: l.nature ?? null,
    }));
  if (frozen.length === 0) return { ok: false, error: (await serverT("serverErrors.invoices"))("noLinesToCredit") };

  const discount = Number(invoice.discountPercent);
  const final = finalLines(frozen, discount, invoice.stampDutyMode, false);
  const totals = totalsOf(final.lines, discount);
  const [row] = await db
    .insert(invoices)
    .values({
      documentType: "TD04",
      originalInvoiceId: invoice.id,
      orderId: invoice.orderId,
      companyId: invoice.companyId,
      currency: invoice.currency,
      series: invoice.series,
      discountPercent: invoice.discountPercent,
      stampDuty: final.stamp.applied,
      stampDutyMode: invoice.stampDutyMode,
      stampDutyNote: invoice.stampDutyNote,
      paymentMethod: invoice.paymentMethod,
      notes:
        mode === "full" ? `Storno totale della fattura n. ${invoice.documentNumber} del ${invoice.issueDate}` : null,
      subtotal: String(totals.subtotal),
      discountAmount: String(totals.discountAmount),
      taxableAmount: String(totals.taxableAmount),
      taxAmount: String(totals.taxAmount),
      total: String(totals.total),
      createdBy: actor.userId,
    })
    .returning({ id: invoices.id });
  await writeLines(db, row.id, frozen);
  revalidatePath(LIST);
  revalidatePath(`${LIST}/${invoice.id}`);
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

  const [current] = await db.select({ documentType: invoices.documentType }).from(invoices).where(eq(invoices.id, id));
  const final = finalLines(
    lines,
    header.discountPercent,
    header.stampDutyMode,
    await rechargesFor(db, current?.documentType ?? "TD01"),
  );
  const totals = totalsOf(final.lines, header.discountPercent);
  const [bumped] = await db
    .update(invoices)
    .set({
      series: header.series,
      dueDate: header.dueDate,
      discountPercent: String(header.discountPercent),
      stampDuty: final.stamp.applied,
      stampDutyMode: header.stampDutyMode,
      stampDutyNote: header.stampDutyNote,
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
  if (!bumped) return { ok: false, error: (await serverT("serverErrors.invoices"))("changedBySomeoneElse") };

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
  if (!invoice || invoice.status !== "draft")
    return { ok: false, error: (await serverT("serverErrors.invoices"))("notDraft") };
  if (invoice.revision !== revision)
    return { ok: false, error: (await serverT("serverErrors.invoices"))("draftChanged") };

  const [items, [company], [issuer]] = await Promise.all([
    db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, id)).orderBy(asc(invoiceItems.position)),
    invoice.companyId ? db.select().from(companies).where(eq(companies.id, invoice.companyId)) : Promise.resolve([]),
    db.select().from(invoiceIssuers).where(eq(invoiceIssuers.id, "workspace")),
  ]);
  const lines = toDraftLines(items);
  const discount = Number(invoice.discountPercent);
  const isCredit = invoice.documentType === "TD04";
  const blockers: IssueBlockers = {
    issuer: issuerGaps(issuer ?? {}),
    customer: company ? customerGaps({ ...company, province: company.state }) : [{ field: "name", problem: "missing" }],
    draft: draftProblems(lines, discount, { mode: invoice.stampDutyMode, note: invoice.stampDutyNote }),
  };
  // Decided again here, from the lines being frozen, rather than trusted from the
  // draft row: the stamp and its recharge line are part of what is issued.
  const recharge = isCredit ? false : Boolean(issuer?.rechargeStampDuty);
  const final = finalLines(lines, discount, invoice.stampDutyMode, recharge);
  const totals = totalsOf(final.lines, discount);
  const room = isCredit ? await creditRoom(db, invoice.originalInvoiceId) : null;
  if (isCredit && !room) blockers.draft.push({ kind: "credit_without_original" });
  if (room && totals.total > room.residual) blockers.draft.push({ kind: "credit_exceeds_residual" });
  if (blockers.issuer.length || blockers.customer.length || blockers.draft.length) {
    return { ok: false, error: (await serverT("serverErrors.invoices"))("cannotIssueYet"), blockers };
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
    linesSnapshot: final.lines,
    stampDuty: final.stamp.applied,
    totals,
    // The statement takes the amount from the original, within what is left, or issues nothing.
    creditOf: isCredit ? invoice.originalInvoiceId : null,
  });
  if (!result) {
    return {
      ok: false,
      error: (await serverT("serverErrors.invoices"))(isCredit ? "creditNoteNotIssued" : "changedInTheMeantime"),
    };
  }
  if (room) revalidatePath(`${LIST}/${room.id}`);

  // The files are kept after the response: the number is already assigned, and a
  // failure here is retried by the next download rather than failing the issue.
  after(() =>
    archiveInvoice(db, id).catch((err) => console.error(`[invoice-archive] invoice ${id} not archived`, err)),
  );

  revalidatePath(LIST);
  revalidatePath(`${LIST}/${id}`);
  return { ok: true, documentNumber: result.documentNumber };
}

// ─── Files and the courtesy copy ──────────────────────────────────────────────

/** Archives an issued invoice's XML and PDF now, for one whose archive failed after issuing. */
export async function archiveInvoiceAction(id: string): Promise<{ ok: boolean; error?: string }> {
  await requireCapability("invoice:write");
  await requirePlanModule("sales");
  const db = await getDb();
  try {
    const outcome = await archiveInvoice(db, id);
    revalidatePath(`${LIST}/${id}`);
    if (outcome === "archived" || outcome === "already" || outcome === "lost_race") return { ok: true };
    return {
      ok: false,
      error: (await serverT("serverErrors.invoices"))(outcome === "missing" ? "notFound" : "archiveOnlyIssued"),
    };
  } catch (err) {
    console.error(`[invoice-archive] invoice ${id} not archived`, err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : (await serverT("serverErrors.invoices"))("archiveFailed"),
    };
  }
}

const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

/**
 * Emails the courtesy PDF to the customer, and records when and to whom.
 *
 * ⚠️ Only an issued invoice: a draft has no number, and a PDF of one would be a
 * document the customer could mistake for the invoice.
 */
export async function sendInvoiceCopy(id: string, to: string): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireCapability("invoice:write");
  await requirePlanModule("sales");
  const address = to.trim();
  if (!EMAIL.test(address)) return { ok: false, error: (await serverT("serverErrors.invoices"))("emailInvalid") };

  const db = await getDb();
  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id));
  if (!invoice) return { ok: false, error: (await serverT("serverErrors.invoices"))("notFound") };
  if (invoice.status !== "issued" || !invoice.documentNumber || !invoice.issueDate) {
    return { ok: false, error: (await serverT("serverErrors.invoices"))("sendOnlyIssued") };
  }

  const pdf = await readInvoiceFile(db, invoice, "pdf");
  const issuer = (invoice.issuerSnapshot ?? {}) as { legalName?: string; email?: string };
  // The language frozen with the customer at issue, so the email matches the PDF it carries.
  const lang = documentLanguage(invoice.customerSnapshot as { language?: string | null; country?: string | null });
  const sent = await sendInvoiceCopyEmail({
    to: address,
    issuerName: issuer.legalName ?? "",
    documentType: invoice.documentType as "TD01" | "TD04",
    documentNumber: invoice.documentNumber,
    issueDate: invoice.issueDate,
    total: formatDocumentMoney(invoice.total, invoice.currency, lang),
    dueDate: invoice.dueDate,
    pdf: { filename: pdf.name, bytes: pdf.bytes },
    replyTo: issuer.email,
    lang,
  });
  if (!sent.success)
    return { ok: false, error: sent.error ?? (await serverT("serverErrors.invoices"))("emailNotSent") };

  await db.update(invoices).set({ emailedAt: new Date(), emailedTo: address }).where(eq(invoices.id, id));
  if (!pdf.archived) {
    after(() =>
      archiveInvoice(db, id).catch((err) => console.error(`[invoice-archive] invoice ${id} not archived`, err)),
    );
  }
  revalidatePath(`${LIST}/${id}`);
  return { ok: true };
}

/** The value the upsert tried to insert, for the columns it updates on conflict. */
/**
 * Stamp duty on the invoices issued in `year`, by quarter, with the F24 deadline.
 *
 * ⚠️ A support figure. The Agenzia computes what is due from SDI data and publishes
 * it in the reserved area; that amount is the one to pay.
 */
export async function getStampDutySummary(year: number) {
  await requireCapability("record:read");
  await requirePlanModule("sales");
  const db = await getDb();
  const rows = await tolerateUnmigrated(
    "invoices",
    () =>
      db
        .select({ issueDate: invoices.issueDate })
        .from(invoices)
        .where(and(eq(invoices.status, "issued"), eq(invoices.stampDuty, true), eq(invoices.fiscalYear, year))),
    [],
  );
  const perQuarter = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const r of rows) if (r.issueDate) perQuarter[quarterOf(r.issueDate)]++;
  return quarterlyStampDuty(year, perQuarter);
}

/** The value the upsert tried to insert, for the columns it updates on conflict. */
function sqlExcluded(column: string) {
  return sql.raw(`excluded.${column}`);
}
