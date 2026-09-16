import {
  DOCUMENT_LOCALE,
  type DocumentLanguage,
  fill,
  formatDocumentMoney,
  INVOICE_TEXT,
  PAYMENT_METHOD_TEXT,
} from "@/lib/document-language";
import type { InvoiceTotals } from "@/lib/fatturapa/totals";
import type { XmlParty } from "@/lib/fatturapa/xml";
import { TAX_REGIMES } from "@/lib/fiscal-ids";
import { NATURE_CODES } from "@/lib/invoice-rules";

import { A4, type Canvas, createCanvas, type Hex } from "./canvas";

/**
 * The courtesy copy of an issued invoice: what a customer can read, print and file.
 *
 * ⚠️ It is not the invoice. In Italy the invoice is the XML that goes through SDI,
 * and a PDF presented as the invoice is a document the customer cannot record. The
 * footer says so on every page, in the wording customers' accountants expect.
 *
 * ⚠️ Everything on it comes from what the invoice froze when it was issued — the
 * issuer, the customer, the lines, the customer's language — so the copy printed
 * next year matches the XML sent today, whatever has happened to the records since.
 */

export interface InvoicePdfData {
  documentType: "TD01" | "TD04";
  documentNumber: string;
  issueDate: string;
  dueDate: string | null;
  currency: string;
  paymentMethod: string;
  notes: string | null;
  stampDuty: boolean;
  issuer: XmlParty & { bankName?: string | null };
  customer: XmlParty;
  totals: InvoiceTotals;
  originalInvoice?: { documentNumber: string; issueDate: string } | null;
  discountPercent: number;
  lang: DocumentLanguage;
}

const MUTED: Hex = "#6b7280";
const BODY: Hex = "#374151";
const RULE: Hex = "#e5e7eb";
const INK: Hex = "#111827";
const MARGIN = 44;

/** dd/mm/yyyy: the form an invoice date takes in both languages. */
const day = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};

function address(p: XmlParty): string[] {
  const cityLine = [p.zipCode, p.city, p.province ? `(${p.province})` : null].filter(Boolean).join(" ");
  return [p.street, cityLine, p.country && p.country !== "IT" ? p.country : null].filter(Boolean) as string[];
}

function ids(p: XmlParty, lang: DocumentLanguage): string | null {
  const tx = INVOICE_TEXT[lang];
  const out: string[] = [];
  if (p.vatNumber) out.push(`${tx.vat} ${p.vatNumber}`);
  if (p.fiscalCode && p.fiscalCode !== p.vatNumber) out.push(`${tx.fiscalCode} ${p.fiscalCode}`);
  return out.length ? out.join(" · ") : null;
}

export async function renderInvoicePdfDocument(data: InvoicePdfData): Promise<Uint8Array> {
  const { lang, issuer, customer, totals } = data;
  const tx = INVOICE_TEXT[lang];
  const money = (n: number) => formatDocumentMoney(n, data.currency, lang);
  const num = (n: number) =>
    new Intl.NumberFormat(DOCUMENT_LOCALE[lang], { maximumFractionDigits: 3, useGrouping: "always" }).format(n);
  const pct = (n: number) => `${num(n)}%`;
  const title = data.documentType === "TD04" ? tx.creditNote : tx.invoice;

  const widths = { qty: 44, price: 74, disc: 46, vat: 46, total: 78 };
  const cols = (c: Canvas) => {
    const desc = c.contentWidth - (widths.qty + widths.price + widths.disc + widths.vat + widths.total);
    let x = c.left + desc;
    const at = (w: number) => {
      const col = { x, w };
      x += w;
      return col;
    };
    return {
      desc: { x: c.left, w: desc - 8 },
      qty: at(widths.qty),
      price: at(widths.price),
      disc: at(widths.disc),
      vat: at(widths.vat),
      total: at(widths.total),
    };
  };
  const tableHeader = (c: Canvas) => {
    const k = cols(c);
    const th = { size: 7, bold: true, color: MUTED };
    c.text(tx.description.toUpperCase(), k.desc.x, c.y, th);
    c.text(tx.quantity.toUpperCase(), k.qty.x, c.y, { ...th, align: "right", width: k.qty.w });
    c.text(tx.price.toUpperCase(), k.price.x, c.y, { ...th, align: "right", width: k.price.w });
    c.text(tx.discount.toUpperCase(), k.disc.x, c.y, { ...th, align: "right", width: k.disc.w });
    c.text(tx.rate.toUpperCase(), k.vat.x, c.y, { ...th, align: "right", width: k.vat.w });
    c.text(tx.amount.toUpperCase(), k.total.x, c.y, { ...th, align: "right", width: k.total.w });
    c.y += 11;
    c.line(c.left, c.y, c.right, c.y, { thickness: 1.2, color: INK });
    c.y += 2;
  };

  // The footer notice is long; its height decides how much room the page body has.
  let inTable = false;
  const c = await createCanvas({
    title: `${title} ${data.documentNumber}`,
    author: issuer.legalName ?? issuer.name ?? undefined,
    language: lang,
    marginX: MARGIN,
    marginTop: MARGIN,
    marginBottom: 80,
    onNewPage: (cv) => {
      if (inTable) tableHeader(cv);
    },
  });

  // ── Header ──
  const top = c.y;
  c.paragraph(issuer.legalName ?? issuer.name ?? "", c.left, 330, { size: 15, bold: true, lineHeight: 19 });
  c.y += 2;
  const regime = issuer.taxRegime ? `${issuer.taxRegime} · ${TAX_REGIMES[issuer.taxRegime] ?? ""}` : null;
  for (const l of [
    ...address(issuer),
    ids(issuer, lang),
    issuer.reaOffice && issuer.reaNumber ? `REA ${issuer.reaOffice}-${issuer.reaNumber}` : null,
    [issuer.email, issuer.phone].filter(Boolean).join(" · ") || null,
  ]) {
    if (l) c.paragraph(l, c.left, 330, { size: 9, color: BODY, lineHeight: 11.5 });
  }
  const leftBottom = c.y;

  let ry = top;
  c.text(title.toUpperCase(), c.left, ry, { size: 8, bold: true, color: MUTED, align: "right", width: c.contentWidth });
  ry += 12;
  c.text(`${tx.number} ${data.documentNumber}`, c.left, ry, {
    size: 18,
    bold: true,
    align: "right",
    width: c.contentWidth,
  });
  ry += 24;
  c.text(`${tx.dated} ${day(data.issueDate)}`, c.left, ry, {
    size: 9,
    color: BODY,
    align: "right",
    width: c.contentWidth,
  });
  ry += 13;
  if (data.originalInvoice) {
    const ref = fill(tx.creditNoteReference, {
      number: data.originalInvoice.documentNumber,
      date: day(data.originalInvoice.issueDate),
    });
    c.text(ref, c.left, ry, { size: 9, color: BODY, align: "right", width: c.contentWidth });
    ry += 13;
  }
  c.y = Math.max(leftBottom, ry) + 20;

  // ── Parties ──
  const gap = 20;
  const boxW = (c.contentWidth - gap) / 2;
  const partyTop = c.y;
  const pad = 10;
  const inner = boxW - pad * 2;

  // Measure both boxes first, so they are drawn the same height.
  const leftLines: [string, boolean][] = [
    [customer.name ?? customer.legalName ?? "", true],
    ...address(customer).map((l): [string, boolean] => [l, false]),
    ...(ids(customer, lang) ? [[ids(customer, lang) as string, false] as [string, boolean]] : []),
  ];
  const delivery =
    customer.sdiCode && customer.sdiCode !== "0000000"
      ? `${tx.recipientCode} ${customer.sdiCode}`
      : customer.pec
        ? `${tx.pec} ${customer.pec}`
        : "—";
  const lineCount = (lines: [string, boolean][]) =>
    lines.reduce((n, [l, bold]) => n + c.wrap(l, inner, { size: 9, bold }).length, 0);
  const leftH = 12 + lineCount(leftLines) * 11.5;
  const rightH = 12 + c.wrap(delivery, inner, { size: 9 }).length * 11.5 + (regime ? 24 : 0);
  const boxH = Math.max(leftH, rightH) + pad * 2;
  c.rect(c.left, partyTop, boxW, boxH, { border: RULE });
  c.rect(c.left + boxW + gap, partyTop, boxW, boxH, { border: RULE });

  c.y = partyTop + pad;
  c.text(tx.customer.toUpperCase(), c.left + pad, c.y, { size: 7, bold: true, color: MUTED });
  c.y += 12;
  for (const [l, bold] of leftLines)
    c.paragraph(l, c.left + pad, inner, { size: 9, bold, color: bold ? INK : BODY, lineHeight: 11.5 });

  c.y = partyTop + pad;
  const rx = c.left + boxW + gap + pad;
  c.text(tx.sdiDelivery.toUpperCase(), rx, c.y, { size: 7, bold: true, color: MUTED });
  c.y += 12;
  c.paragraph(delivery, rx, inner, { size: 9, color: BODY, lineHeight: 11.5 });
  if (regime) {
    c.y += 4;
    c.text(tx.issuerRegime.toUpperCase(), rx, c.y, { size: 7, bold: true, color: MUTED });
    c.y += 12;
    c.paragraph(regime, rx, inner, { size: 9, color: BODY, lineHeight: 11.5 });
  }
  c.y = partyTop + boxH + 20;

  // ── Lines ──
  tableHeader(c);
  inTable = true;
  for (const d of totals.details) {
    const k = cols(c);
    const description = d.isDocumentDiscount
      ? fill(tx.documentDiscount, { percent: pct(data.discountPercent) })
      : d.description;
    const lines = c.wrap(description, k.desc.w, { size: 9 });
    const h = Math.max(18, 7 + lines.length * 11.5);
    c.ensure(h);
    const rowTop = c.y;
    let ly = rowTop + 5;
    for (const l of lines) {
      c.text(l, k.desc.x, ly, { size: 9 });
      ly += 11.5;
    }
    const right = { size: 9, align: "right" as const };
    if (d.quantity !== null) c.text(num(d.quantity), k.qty.x, rowTop + 5, { ...right, width: k.qty.w });
    if (!d.isDocumentDiscount) c.text(money(d.unitPrice), k.price.x, rowTop + 5, { ...right, width: k.price.w });
    if (d.discountPercent) c.text(num(d.discountPercent), k.disc.x, rowTop + 5, { ...right, width: k.disc.w });
    c.text(d.nature ?? pct(d.rate), k.vat.x, rowTop + 5, { ...right, width: k.vat.w });
    c.text(money(d.total), k.total.x, rowTop + 5, { ...right, width: k.total.w });
    c.y = rowTop + h;
    c.line(c.left, c.y, c.right, c.y);
  }
  inTable = false;

  // ── Payment, notices and totals, side by side ──
  const leftW = c.contentWidth * 0.55;
  const sumX = c.left + leftW + 24;
  const sumW = c.right - sumX;
  const natures = [...new Set(totals.summary.map((r) => r.nature).filter(Boolean))] as string[];

  const blocks: { label?: string; lines: string[] }[] = [
    {
      label: tx.payment,
      lines: [
        PAYMENT_METHOD_TEXT[lang][data.paymentMethod] ?? data.paymentMethod,
        ...(data.dueDate ? [`${tx.due} ${day(data.dueDate)}`] : []),
        ...(issuer.iban ? [`IBAN ${issuer.iban}${issuer.bankName ? ` · ${issuer.bankName}` : ""}`] : []),
      ],
    },
    ...(natures.length
      ? [{ label: tx.exemptOperations, lines: natures.map((n) => `${n} · ${NATURE_CODES[n] ?? ""}`) }]
      : []),
    ...(data.stampDuty ? [{ lines: [tx.stampNotice] }] : []),
    ...(data.notes ? [{ label: tx.notes, lines: [data.notes] }] : []),
  ];
  const blockHeight = blocks.reduce(
    (h, b) => h + (b.label ? 11 : 0) + b.lines.reduce((n, l) => n + c.wrap(l, leftW, { size: 9 }).length * 11.5, 0) + 8,
    0,
  );
  const sumHeight = (totals.summary.length + 1) * 14 + 30;
  c.ensure(Math.max(blockHeight, sumHeight) + 16);
  c.y += 14;
  const lowerTop = c.y;

  for (const b of blocks) {
    if (b.label) {
      c.text(b.label.toUpperCase(), c.left, c.y, { size: 7, bold: true, color: MUTED });
      c.y += 11;
    }
    for (const l of b.lines) c.paragraph(l, c.left, leftW, { size: 9, color: BODY, lineHeight: 11.5 });
    c.y += 8;
  }
  const leftEnd = c.y;

  let sy = lowerTop;
  const sumRow = (l: string, v: string, muted = false) => {
    c.text(l, sumX, sy, { size: 9, color: muted ? MUTED : INK });
    c.text(v, sumX, sy, { size: 9, align: "right", width: sumW });
    sy += 14;
  };
  sumRow(tx.taxable, money(totals.taxableAmount));
  for (const r of totals.summary) {
    const label = r.nature
      ? fill(tx.natureOn, { nature: r.nature, taxable: money(r.taxable) })
      : fill(tx.vatOn, { rate: pct(r.rate), taxable: money(r.taxable) });
    sumRow(label, money(r.tax), true);
  }
  c.line(sumX, sy + 2, c.right, sy + 2, { thickness: 1.2, color: INK });
  sy += 9;
  c.text(tx.documentTotal, sumX, sy, { size: 12, bold: true });
  c.text(money(totals.total), sumX, sy, { size: 12, bold: true, align: "right", width: sumW });
  c.y = Math.max(leftEnd, sy + 20);

  return c.save((cv, i, count) => {
    const y = A4.height - 62;
    cv.line(cv.left, y, cv.right, y);
    const pageLabel = `${i + 1} / ${count}`;
    const labelW = cv.width(pageLabel, { size: 7 });
    let ly = y + 7;
    for (const l of cv.wrap(tx.courtesyNotice, cv.contentWidth - labelW - 16, { size: 7 })) {
      cv.text(l, cv.left, ly, { size: 7, color: MUTED });
      ly += 9.5;
    }
    cv.text(pageLabel, cv.left, y + 7, { size: 7, color: MUTED, align: "right", width: cv.contentWidth });
  });
}
