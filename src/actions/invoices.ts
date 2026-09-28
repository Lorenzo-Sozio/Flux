"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, or, type SQL, sql } from "drizzle-orm";

import {
  companies,
  invoiceIssuers,
  invoiceItems,
  invoices,
  orderItems,
  orderPayments,
  orders,
  products,
} from "@/db/schema";
import { requireCapability, requirePlanModule } from "@/lib/auth-guard";
import {
  type DocumentLanguage,
  documentLanguage,
  fill,
  formatDocumentMoney,
  INVOICE_TEXT,
} from "@/lib/document-language";
import { sendInvoiceCopyEmail } from "@/lib/email";
import { type InvoiceLine, invoiceTotals } from "@/lib/fatturapa/totals";
import { customerGaps, type Gap, issuerGaps } from "@/lib/fiscal-ids";
import { serverT } from "@/lib/i18n-server";
import { archiveInvoice, readInvoiceFile } from "@/lib/invoice-archive";
import { deductionLines, depositLines, type IssuedDeposit } from "@/lib/invoice-deposits";
import { cleanDraft, customerSnapshot, type DraftInput, italianToday, linesFromOrder } from "@/lib/invoice-draft";
import { issueInvoice } from "@/lib/invoice-issue";
import { type DraftLine, type DraftProblem, draftProblems, invoiceScope } from "@/lib/invoice-rules";
import { parsePaymentAmount, paymentDay } from "@/lib/order-payment";
import { type ListParams, offsetOf, toPage } from "@/lib/pagination";
import { cleanTerms, installmentsFor, installmentsMatch, isPreset } from "@/lib/payment-terms";
import { openCredits, removeAllocation } from "@/lib/receipts";
import {
  balanceOf,
  invoiceBalance,
  invoicePayments,
  linkOrderPayments,
  receivables,
  recordInvoicePayment,
} from "@/lib/receivables";
import { tolerateUnmigrated } from "@/lib/schema-ready";
import { assessStampDuty, quarterlyStampDuty, quarterOf, type StampMode, withStampRecharge } from "@/lib/stamp-duty";
import { getDb } from "@/lib/tenant-context";
import { toWallDate } from "@/lib/wall-clock";
import { dispatchWebhook } from "@/lib/webhook-dispatch";
import { getWorkspaceTimeZone } from "@/lib/workspace-time-zone";

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
function finalLines(
  lines: DraftLine[],
  discountPercent: number,
  mode: string,
  recharge: boolean,
  /** A balance invoice's lines taking its deposits off (I11): generated, never typed. */
  deductions: readonly DraftLine[] = [],
) {
  const all = [...lines, ...deductions];
  const stamp = assessStampDuty(all, discountPercent, mode as StampMode);
  const withDescription = all.map((l) => ({ ...l, description: l.description ?? "" }));
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
      deductedInInvoiceId: invoices.deductedInInvoiceId,
    })
    .from(invoices)
    .where(eq(invoices.id, originalId));
  if (!original || original.status !== "issued" || !["TD01", "TD02"].includes(original.documentType)) return null;
  // A deposit already taken off a balance invoice is corrected on that invoice, not here.
  if (original.deductedInInvoiceId) return null;
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

// ─── Deposits and the balance (I11) ───────────────────────────────────────────

/** A day as the documents print it: 28/09/2026. */
function printedDay(day: string | null): string {
  return day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}` : "";
}

/** The deposit invoices a balance invoice names, as they were issued. Anything else is dropped. */
async function depositsOf(db: Db, ids: readonly string[] | null | undefined): Promise<IssuedDeposit[]> {
  if (!ids?.length) return [];
  const rows = await db
    .select({
      id: invoices.id,
      documentNumber: invoices.documentNumber,
      issueDate: invoices.issueDate,
      discountPercent: invoices.discountPercent,
      linesSnapshot: invoices.linesSnapshot,
      status: invoices.status,
      documentType: invoices.documentType,
    })
    .from(invoices)
    .where(inArray(invoices.id, [...ids]));
  return rows
    .filter((r) => r.status === "issued" && r.documentType === "TD02")
    .map((r) => ({
      id: r.id,
      documentNumber: r.documentNumber,
      issueDate: r.issueDate,
      discountPercent: Number(r.discountPercent),
      lines: (r.linesSnapshot ?? []) as InvoiceLine[],
    }));
}

/**
 * The order's issued deposit invoices no invoice has taken off yet, oldest first: what a new
 * invoice for the order deducts. A deposit a credit note touched is left out — what is left of
 * it is not a plain deposit any more, and a person decides.
 */
async function undeductedDeposits(db: Db, orderId: string): Promise<IssuedDeposit[]> {
  const rows = await tolerateUnmigrated(
    "invoice.deducted_in_invoice_id",
    () =>
      db
        .select({ id: invoices.id })
        .from(invoices)
        .where(
          and(
            eq(invoices.orderId, orderId),
            eq(invoices.status, "issued"),
            eq(invoices.documentType, "TD02"),
            isNull(invoices.deductedInInvoiceId),
            eq(invoices.creditedAmount, "0"),
          ),
        )
        .orderBy(asc(invoices.issueDate), asc(invoices.number)),
    [] as { id: string }[],
  );
  return depositsOf(
    db,
    rows.map((r) => r.id),
  );
}

/** The lines taking these deposits off, in the customer's language. */
function deductionsFor(deposits: IssuedDeposit[], language: DocumentLanguage): DraftLine[] {
  const tx = INVOICE_TEXT[language];
  return deductionLines(deposits, (number, date) =>
    fill(tx.deductionLine, { number, date: printedDay(date) }),
  ) as unknown as DraftLine[];
}

/**
 * A deposit invoice (TD02) for part of an order, as a draft: `amount` is what the customer
 * pays, VAT included, split across the order's VAT rates in the order's proportion
 * (src/lib/invoice-deposits.ts). Reviewed and issued like any invoice.
 *
 * ⚠️ Never more than is left to invoice on the order: its total less every invoice and deposit
 * invoice already written for it, drafts included — two deposits typed at once would otherwise
 * invoice the order twice.
 */
export async function createDepositInvoice(
  orderId: string,
  amount: number | string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const actor = await requireCapability("invoice:write");
  await requirePlanModule("sales");
  const t = await serverT("serverErrors.invoices");
  const gross = parsePaymentAmount(amount);
  if (gross === null) return { ok: false, error: t("depositAmount") };
  const db = await getDb();

  const [order] = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      companyId: orders.companyId,
      currency: orders.currency,
      discountPercent: orders.discountPercent,
    })
    .from(orders)
    .where(eq(orders.id, orderId));
  if (!order?.companyId) return { ok: false, error: t("chooseCustomer") };
  // After the invoice for the order there is nothing to take a deposit on: it would be invoiced twice.
  const [invoiced] = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(
      and(
        eq(invoices.orderId, orderId),
        eq(invoices.documentType, "TD01"),
        inArray(invoices.status, ["draft", "issued"]),
      ),
    );
  if (invoiced) return { ok: false, error: t("depositAfterInvoice") };
  const [company] = await db
    .select({ language: companies.language, country: companies.country })
    .from(companies)
    .where(eq(companies.id, order.companyId));
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
    .leftJoin(products, eq(orderItems.productId, products.id))
    .where(eq(orderItems.orderId, orderId));

  const orderLines = linesFromOrder(items).map((l) => ({ ...l, description: l.description }));
  const discount = Number(order.discountPercent ?? 0);
  const orderTotal = invoiceTotals(orderLines, discount).total;
  const [written] = await db
    .select({ total: sql<string>`coalesce(sum(${invoices.total}), 0)` })
    .from(invoices)
    .where(
      and(
        eq(invoices.orderId, orderId),
        inArray(invoices.documentType, ["TD01", "TD02"]),
        inArray(invoices.status, ["draft", "issued"]),
      ),
    );
  const left = Math.round((orderTotal - Number(written?.total ?? 0)) * 100) / 100;
  if (gross > left) return { ok: false, error: t("depositExceedsOrder", { left: left.toFixed(2) }) };

  const tx = INVOICE_TEXT[documentLanguage(company)];
  const lines = depositLines(orderLines, discount, gross, (rate, _nature, several) =>
    several
      ? fill(tx.depositLineRate, { order: order.orderNumber, rate: `${rate}%` })
      : fill(tx.depositLine, { order: order.orderNumber }),
  );
  if (!lines?.length) return { ok: false, error: t("depositAmount") };

  const final = finalLines(lines, 0, "auto", await issuerRecharges(db));
  const totals = totalsOf(final.lines, 0);
  const [row] = await db
    .insert(invoices)
    .values({
      documentType: "TD02",
      orderId,
      companyId: order.companyId,
      currency: order.currency || "EUR",
      series: "",
      discountPercent: "0",
      stampDuty: final.stamp.applied,
      stampDutyMode: "auto",
      paymentMethod: "MP05",
      subtotal: String(totals.subtotal),
      discountAmount: String(totals.discountAmount),
      taxableAmount: String(totals.taxableAmount),
      taxAmount: String(totals.taxAmount),
      total: String(totals.total),
      createdBy: actor.userId,
    })
    .returning({ id: invoices.id });
  await writeLines(db, row.id, lines);
  revalidatePath(LIST);
  revalidatePath(`/dashboard/sales/orders/${orderId}`);
  return { ok: true, id: row.id };
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
  // A balance invoice takes its deposit invoices off (I11): the lines are generated from them.
  const deposits = invoice.documentType === "TD01" ? await depositsOf(db, invoice.deducts) : [];
  const deductions = deductionsFor(deposits, documentLanguage(company));
  const final = finalLines(lines, discount, invoice.stampDutyMode, recharge, deductions);
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
  const draftChecks = draftProblems(
    lines,
    discount,
    { mode: invoice.stampDutyMode, note: invoice.stampDutyNote },
    deductions,
  );
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
  // Installments written by hand must add up to what the draft totals now (I12).
  const terms = cleanTerms(invoice.paymentTerms);
  if (
    invoice.status === "draft" &&
    !isCredit &&
    terms &&
    "custom" in terms &&
    !installmentsMatch(
      terms.custom,
      invoiceTotals(
        final.lines.map((l) => ({ ...l, description: l.description ?? "" })),
        discount,
      ).total,
    )
  )
    draftChecks.push({ kind: "installments_total" });
  const blockers: IssueBlockers = {
    issuer: issuerGaps(issuer ?? {}),
    customer: company ? customerGaps({ ...company, province: company.state }) : [{ field: "name", problem: "missing" }],
    draft: draftChecks,
  };
  return {
    invoice,
    original,
    creditNotes,
    // The deposit invoices this balance takes off, and the lines that do it.
    deposits: deposits.map((d) => ({ id: d.id, documentNumber: d.documentNumber, issueDate: d.issueDate })),
    deductions,
    // For a deposit invoice: the balance invoice that took it off, if one has.
    deductedIn: invoice.deductedInInvoiceId
      ? ((
          await db
            .select({ id: invoices.id, documentNumber: invoices.documentNumber })
            .from(invoices)
            .where(eq(invoices.id, invoice.deductedInInvoiceId))
        )[0] ?? null)
      : null,
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
        // Their usual terms, which a new invoice to them starts with (I12).
        paymentTerms: companies.paymentTerms,
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

  const [company] = await db
    .select({ id: companies.id, paymentTerms: companies.paymentTerms })
    .from(companies)
    .where(eq(companies.id, input.companyId));
  if (!company) return { ok: false, error: (await serverT("serverErrors.invoices"))("chooseCustomer") };

  const orderId = input.orderId || null;
  if (orderId) {
    const [draft] = await db
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.orderId, orderId), eq(invoices.status, "draft"), eq(invoices.documentType, "TD01")));
    if (draft)
      return { ok: false, error: (await serverT("serverErrors.invoices"))("orderHasDraft"), existingId: draft.id };
    // A deposit invoice still in draft would not be taken off: it is issued, or deleted, first.
    const [depositDraft] = await db
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.orderId, orderId), eq(invoices.status, "draft"), eq(invoices.documentType, "TD02")));
    if (depositDraft)
      return {
        ok: false,
        error: (await serverT("serverErrors.invoices"))("depositStillDraft"),
        existingId: depositDraft.id,
      };
  }

  // An invoice for an order whose deposits were invoiced is the balance: it takes them off (I11).
  const deposits = orderId ? await undeductedDeposits(db, orderId) : [];
  const [language] = await db
    .select({ language: companies.language, country: companies.country })
    .from(companies)
    .where(eq(companies.id, company.id));
  const final = finalLines(
    lines,
    header.discountPercent,
    header.stampDutyMode,
    await issuerRecharges(db),
    deductionsFor(deposits, documentLanguage(language)),
  );
  const totals = totalsOf(final.lines, header.discountPercent);
  const [row] = await db
    .insert(invoices)
    .values({
      documentType: "TD01",
      deducts: deposits.length > 0 ? deposits.map((d) => d.id) : null,
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
      // Not chosen on the form: the customer's usual terms (I12).
      paymentTerms:
        input.paymentTerms === undefined && isPreset(company.paymentTerms)
          ? { preset: company.paymentTerms }
          : (header.paymentTerms ?? null),
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

  const [current] = await db
    .select({ documentType: invoices.documentType, deducts: invoices.deducts, companyId: invoices.companyId })
    .from(invoices)
    .where(eq(invoices.id, id));
  const [customer] = current?.companyId
    ? await db
        .select({ language: companies.language, country: companies.country })
        .from(companies)
        .where(eq(companies.id, current.companyId))
    : [];
  const final = finalLines(
    lines,
    header.discountPercent,
    header.stampDutyMode,
    await rechargesFor(db, current?.documentType ?? "TD01"),
    current?.documentType === "TD01"
      ? deductionsFor(await depositsOf(db, current.deducts), documentLanguage(customer))
      : [],
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
      paymentTerms: header.paymentTerms ?? null,
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
  // A balance invoice's deposits, as issued: one that is no longer there cannot be taken off.
  const deducts = invoice.documentType === "TD01" ? (invoice.deducts ?? []) : [];
  const deposits = await depositsOf(db, deducts);
  if (deposits.length !== deducts.length)
    return { ok: false, error: (await serverT("serverErrors.invoices"))("depositGone") };
  const deductions = deductionsFor(deposits, documentLanguage(company));
  const blockers: IssueBlockers = {
    issuer: issuerGaps(issuer ?? {}),
    customer: company ? customerGaps({ ...company, province: company.state }) : [{ field: "name", problem: "missing" }],
    draft: draftProblems(lines, discount, { mode: invoice.stampDutyMode, note: invoice.stampDutyNote }, deductions),
  };
  // Decided again here, from the lines being frozen, rather than trusted from the
  // draft row: the stamp and its recharge line are part of what is issued.
  const recharge = isCredit ? false : Boolean(issuer?.rechargeStampDuty);
  const final = finalLines(lines, discount, invoice.stampDutyMode, recharge, deductions);
  const totals = totalsOf(final.lines, discount);
  const room = isCredit ? await creditRoom(db, invoice.originalInvoiceId) : null;
  if (isCredit && !room) blockers.draft.push({ kind: "credit_without_original" });
  if (room && totals.total > room.residual) blockers.draft.push({ kind: "credit_exceeds_residual" });
  // The terms become dated amounts now, from the day it is issued and what it totals (I12). A
  // credit note gives money back and has no installments.
  const issueDate = italianToday();
  const terms = isCredit ? null : cleanTerms(invoice.paymentTerms);
  const installments = terms ? installmentsFor(terms, issueDate, totals.total) : null;
  if (installments && !installmentsMatch(installments, totals.total))
    blockers.draft.push({ kind: "installments_total" });
  if (blockers.issuer.length || blockers.customer.length || blockers.draft.length) {
    return { ok: false, error: (await serverT("serverErrors.invoices"))("cannotIssueYet"), blockers };
  }

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
    // And takes each deposit off once, or issues nothing (I11).
    deducts,
    installments,
  });
  if (!result) {
    return {
      ok: false,
      error: (await serverT("serverErrors.invoices"))(
        isCredit ? "creditNoteNotIssued" : deducts.length > 0 ? "depositTakenOff" : "changedInTheMeantime",
      ),
    };
  }
  for (const d of deducts) revalidatePath(`${LIST}/${d}`);
  if (room) revalidatePath(`${LIST}/${room.id}`);

  // Money already on the order — a deposit — reaches its only invoice now (I9). And an invoice
  // settled by this issue, by those payments or by a credit note bringing what is due down to
  // what was paid, says so: settlement is not only a payment arriving.
  const settledNow = async (invoiceId: string, creditedNow: number) => {
    const balance = await tolerateUnmigrated("invoice payments", () => balanceOf(db, invoiceId), null);
    if (!balance || balance.outstanding > 0 || balance.paid <= 0) return;
    if (balance.outstanding + creditedNow <= 0 && creditedNow > 0) return; // already settled before
    dispatchWebhook(
      "invoice.paid",
      { id: invoiceId, paid: balance.paid, due: balance.due },
      { via: "user", actor: actor.userId },
    ).catch((err) => console.error("[invoices] invoice.paid not dispatched", err));
  };
  if (!isCredit && invoice.orderId) {
    const linked = await tolerateUnmigrated(
      "invoice payments",
      () => linkOrderPayments(db, invoice.orderId as string),
      0,
    );
    if (linked > 0) await settledNow(id, 0);
  }
  if (isCredit && room) await settledNow(room.id, totals.total);

  // An accounting system waits for this more than for anything else a CRM does (§13.11).
  dispatchWebhook(
    "invoice.issued",
    {
      id,
      number: result.documentNumber,
      documentType: invoice.documentType,
      issueDate,
      total: totals.total,
      currency: invoice.currency,
      companyId: invoice.companyId,
      orderId: invoice.orderId,
      originalInvoiceId: isCredit ? invoice.originalInvoiceId : null,
      depositInvoiceIds: deducts,
    },
    { via: "user", actor: actor.userId },
  ).catch((err) => console.error("[invoices] invoice.issued not dispatched", err));

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

// ─── Payments and receivables (I9) ────────────────────────────────────────────

/** The payments recorded against an invoice, with its balance. */
export async function getInvoicePayments(invoiceId: string) {
  await requireCapability("record:read");
  await requirePlanModule("sales");
  const db = await getDb();
  const [invoice] = await db
    .select({
      total: invoices.total,
      credited: invoices.creditedAmount,
      companyId: invoices.companyId,
      currency: invoices.currency,
    })
    .from(invoices)
    .where(eq(invoices.id, invoiceId));
  if (!invoice) return null;
  const [payments, credits] = await Promise.all([
    tolerateUnmigrated("invoice payments", () => invoicePayments(db, invoiceId), []),
    // The customer's money not yet used, in this invoice's currency: what "use credit" can spend (I10).
    invoice.companyId
      ? tolerateUnmigrated("receipts", () => openCredits(db, invoice.companyId as string), [])
      : Promise.resolve([]),
  ]);
  return {
    payments,
    balance: invoiceBalance(invoice.total, invoice.credited, payments),
    companyId: invoice.companyId,
    credits: credits.filter((c) => c.currency === invoice.currency),
  };
}

/**
 * Money arrived against an issued invoice (src/lib/receivables.ts). Settling it in full
 * sends `invoice.paid`: the accounting system waits for that one as much as for the issue.
 */
export async function recordInvoicePaymentAction(
  invoiceId: string,
  data: { amount: number | string; paidAt?: string; method?: string; note?: string; reference?: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireCapability("invoice:write");
  await requirePlanModule("sales");
  const [db, timeZone] = await Promise.all([getDb(), getWorkspaceTimeZone()]);
  const paidAt = paymentDay(data.paidAt, timeZone);
  if (!paidAt) return { ok: false, error: (await serverT("serverErrors.invoices"))("payment.invalid_date") };
  const result = await recordInvoicePayment(db, {
    invoiceId,
    amount: data.amount,
    paidAt,
    method: data.method,
    reference: data.reference,
    note: data.note,
    by: actor.userId,
  });
  if (!result.ok) return { ok: false, error: (await serverT("serverErrors.invoices"))(`payment.${result.reason}`) };

  if (result.becamePaid) {
    dispatchWebhook(
      "invoice.paid",
      { id: invoiceId, paid: result.balance.paid, due: result.balance.due },
      { via: "user", actor: actor.userId },
    ).catch((err) => console.error("[invoices] invoice.paid not dispatched", err));
  }
  revalidatePath(`${LIST}/${invoiceId}`);
  revalidatePath("/dashboard/sales/finance");
  return { ok: true };
}

/**
 * A payment recorded by mistake, taken back. Whoever may write the invoice may do it. The
 * receipt goes with it when this was all of it; a share of a larger transfer returns to the
 * customer's credit instead (src/lib/receipts.ts).
 */
export async function deleteInvoicePaymentAction(paymentId: string): Promise<{ ok: boolean }> {
  await requireCapability("invoice:write");
  await requirePlanModule("sales");
  const db = await getDb();
  const [row] = await db
    .select({ id: orderPayments.id })
    .from(orderPayments)
    .where(and(eq(orderPayments.id, paymentId), sql`${orderPayments.invoiceId} is not null`));
  if (!row) return { ok: false };
  const removed = await removeAllocation(db, paymentId);
  if (removed.invoiceId) revalidatePath(`${LIST}/${removed.invoiceId}`);
  if (removed.orderId) revalidatePath(`/dashboard/sales/orders/${removed.orderId}`);
  revalidatePath("/dashboard/sales/finance");
  return { ok: removed.removed !== null };
}

/** The receivables schedule: every issued invoice still owed something, by age. */
export async function getReceivables() {
  await requireCapability("settings:manage");
  await requirePlanModule("sales");
  const [db, timeZone] = await Promise.all([getDb(), getWorkspaceTimeZone()]);
  return tolerateUnmigrated("receivables", () => receivables(db, { today: toWallDate(new Date(), timeZone) }), null);
}
