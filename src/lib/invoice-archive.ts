import { createElement } from "react";

import { randomUUID } from "node:crypto";

import { renderToBuffer } from "@react-pdf/renderer";
import { and, eq, isNull, sql } from "drizzle-orm";

import { InvoicePDF, type InvoicePdfData } from "@/components/pdf/invoice-pdf";
import { invoices } from "@/db/schema";
import { documentLanguage, INVOICE_TEXT } from "@/lib/document-language";
import { type InvoiceLine, invoiceTotals } from "@/lib/fatturapa/totals";
import {
  buildFatturaPaXml,
  fatturaPaFileName,
  transmissionIdFor,
  type XmlInvoice,
  type XmlParty,
} from "@/lib/fatturapa/xml";
import { contentHash, getStorage, type StorageDriver } from "@/lib/storage";

/**
 * Keeping an issued invoice's files: the FatturaPA XML and the courtesy PDF.
 *
 * ⚠️⚠️ **Written once, and the write decides.** Two requests can archive the same
 * invoice at once (the one after issuing and a download that finds nothing yet).
 * Each writes its own objects under fresh keys, then records them with an update
 * that only applies while no key is recorded. The loser deletes what it wrote, so
 * the invoice ends with exactly one pair of files and nothing is overwritten.
 *
 * ⚠️ Archiving never decides whether an invoice exists. Issuing has already
 * happened and numbered it; a failure here is logged and the files are built from
 * the frozen snapshots on the next download, which archives them then.
 *
 * Keys carry nothing from the invoice — no number, no customer — so a bucket
 * listing tells nobody whose invoices are in it.
 */

type Invoice = typeof invoices.$inferSelect;
// biome-ignore lint/suspicious/noExplicitAny: a tenant handle, from getDb or createTenantDb
type Db = any;

export type ArchiveKind = "xml" | "pdf";

const CONTENT_TYPE: Record<ArchiveKind, string> = {
  xml: "application/xml; charset=utf-8",
  pdf: "application/pdf",
};

export function archiveKey(kind: ArchiveKind, now = new Date()): string {
  const yyyymm = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return `invoices/${yyyymm}/${randomUUID()}.${kind}`;
}

/** True only for a key `archiveKey` could have produced, of that kind. */
export function isValidArchiveKey(key: string, kind: ArchiveKind): boolean {
  return new RegExp(`^invoices/\\d{6}/[0-9a-f-]{36}\\.${kind}$`).test(key);
}

/** The original of a credit note, as the XML and the PDF cite it. */
async function originalOf(db: Db, invoice: Invoice) {
  if (!invoice.originalInvoiceId) return null;
  const [row] = await db
    .select({ documentNumber: invoices.documentNumber, issueDate: invoices.issueDate })
    .from(invoices)
    .where(eq(invoices.id, invoice.originalInvoiceId));
  return row?.documentNumber && row.issueDate ? { documentNumber: row.documentNumber, issueDate: row.issueDate } : null;
}

/** The XML document of an issued invoice, from its snapshots only. */
export function xmlInputOf(
  invoice: Invoice,
  originalInvoice: { documentNumber: string; issueDate: string } | null,
): XmlInvoice {
  if (invoice.status !== "issued" || !invoice.documentNumber || !invoice.issueDate) {
    throw new Error("Only an issued invoice has files.");
  }
  return {
    documentType: invoice.documentType as "TD01" | "TD04",
    documentNumber: invoice.documentNumber,
    issueDate: invoice.issueDate,
    currency: invoice.currency,
    discountPercent: Number(invoice.discountPercent),
    stampDuty: invoice.stampDuty,
    paymentMethod: invoice.paymentMethod,
    dueDate: invoice.dueDate,
    notes: invoice.notes,
    issuer: (invoice.issuerSnapshot ?? {}) as XmlParty,
    customer: (invoice.customerSnapshot ?? {}) as XmlParty,
    lines: (invoice.linesSnapshot ?? []) as InvoiceLine[],
    transmissionId: transmissionIdFor(invoice.fiscalYear ?? 0, invoice.number ?? 0, invoice.series),
    originalInvoice,
  };
}

export function pdfDataOf(input: XmlInvoice): InvoicePdfData {
  return {
    documentType: input.documentType,
    documentNumber: input.documentNumber,
    issueDate: input.issueDate,
    dueDate: input.dueDate ?? null,
    currency: input.currency,
    paymentMethod: input.paymentMethod,
    notes: input.notes ?? null,
    stampDuty: input.stampDuty,
    issuer: input.issuer,
    customer: input.customer,
    totals: invoiceTotals(input.lines, input.discountPercent),
    originalInvoice: input.originalInvoice ?? null,
    discountPercent: input.discountPercent,
    // Frozen in the customer snapshot at issue; read from the country for invoices issued before.
    lang: documentLanguage(input.customer as { language?: string | null; country?: string | null }),
  };
}

/** A file name a person recognises; the XML keeps the name SDI requires. */
export function fileNameOf(input: XmlInvoice, kind: ArchiveKind): string {
  if (kind === "xml") return fatturaPaFileName(input);
  const lang = documentLanguage(input.customer as { language?: string | null; country?: string | null });
  const tx = INVOICE_TEXT[lang];
  const kindName = (input.documentType === "TD04" ? tx.creditNote : tx.invoice).replace(/\s+/g, "-");
  return `${kindName}-${input.documentNumber.replace(/[^A-Za-z0-9-]/g, "-")}.pdf`;
}

export async function renderInvoicePdf(input: XmlInvoice): Promise<Uint8Array> {
  // biome-ignore lint/suspicious/noExplicitAny: renderToBuffer wants a <Document> element type
  const element = createElement(InvoicePDF, { data: pdfDataOf(input) }) as any;
  return new Uint8Array(await renderToBuffer(element));
}

export async function buildFile(input: XmlInvoice, kind: ArchiveKind): Promise<Uint8Array> {
  return kind === "xml" ? new TextEncoder().encode(buildFatturaPaXml(input)) : renderInvoicePdf(input);
}

export type ArchiveOutcome = "archived" | "already" | "not_issued" | "missing" | "lost_race";

/**
 * Writes both files and records them, unless another request already did.
 * `storage` is injectable for the tests; production uses the configured store.
 */
export async function archiveInvoice(db: Db, id: string, storage?: StorageDriver): Promise<ArchiveOutcome> {
  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id));
  if (!invoice) return "missing";
  if (invoice.status !== "issued") return "not_issued";
  if (invoice.xmlKey && invoice.pdfKey) return "already";

  const input = xmlInputOf(invoice, await originalOf(db, invoice));
  const [xml, pdf] = await Promise.all([buildFile(input, "xml"), buildFile(input, "pdf")]);
  const store = storage ?? (await getStorage());
  const xmlKey = archiveKey("xml");
  const pdfKey = archiveKey("pdf");
  await store.put(xmlKey, xml, CONTENT_TYPE.xml);
  await store.put(pdfKey, pdf, CONTENT_TYPE.pdf);

  const won = await db
    .update(invoices)
    .set({
      xmlKey,
      xmlSha256: contentHash(xml),
      pdfKey,
      pdfSha256: contentHash(pdf),
      archivedAt: sql`now()`,
    })
    .where(and(eq(invoices.id, id), eq(invoices.status, "issued"), isNull(invoices.xmlKey)))
    .returning({ id: invoices.id });

  if (won.length === 0) {
    await Promise.all([store.delete(xmlKey), store.delete(pdfKey)]).catch(() => undefined);
    return "lost_race";
  }
  return "archived";
}

/**
 * One file of an issued invoice: the archived bytes when they are there and still
 * match their hash, otherwise built again from the snapshots.
 *
 * ⚠️ The XML rebuilt from the snapshots is the same document, which is why falling
 * back is safe. An archived object that no longer matches its hash is reported,
 * not served.
 */
export async function readInvoiceFile(
  db: Db,
  invoice: Invoice,
  kind: ArchiveKind,
  storage?: StorageDriver,
): Promise<{ bytes: Uint8Array; name: string; contentType: string; archived: boolean }> {
  const input = xmlInputOf(invoice, await originalOf(db, invoice));
  const name = fileNameOf(input, kind);
  const key = kind === "xml" ? invoice.xmlKey : invoice.pdfKey;
  const expected = kind === "xml" ? invoice.xmlSha256 : invoice.pdfSha256;

  if (key && isValidArchiveKey(key, kind)) {
    try {
      const store = storage ?? (await getStorage());
      const bytes = await store.get(key);
      if (bytes && contentHash(bytes) === expected) {
        return { bytes, name, contentType: CONTENT_TYPE[kind], archived: true };
      }
      console.error(
        `[invoice-archive] ${kind} of invoice ${invoice.id} is ${bytes ? "altered" : "missing"} in storage`,
      );
    } catch (err) {
      console.error(`[invoice-archive] reading ${kind} of invoice ${invoice.id} failed`, err);
    }
  }
  return { bytes: await buildFile(input, kind), name, contentType: CONTENT_TYPE[kind], archived: false };
}
