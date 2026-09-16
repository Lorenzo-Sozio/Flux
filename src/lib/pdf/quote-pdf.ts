import {
  DOCUMENT_LOCALE,
  type DocumentLanguage,
  formatDocumentDate,
  formatDocumentMoney,
  formatDocumentPercent,
  QUOTE_TEXT,
  quoteStatusText,
} from "@/lib/document-language";
import type { SellerIdentity } from "@/lib/seller-identity";

import { type Canvas, createCanvas, type Hex } from "./canvas";

/**
 * The quote as the customer receives it: in their language, in the quote's own
 * currency, from the company making the offer.
 */

export interface QuotePdfInput {
  quoteNumber: string;
  status: string;
  currency: string;
  subtotal: string | null;
  discountAmount: string | null;
  discountPercent: string | null;
  taxAmount: string | null;
  taxPercent: string | null;
  totalAmount: string | null;
  notes: string | null;
  issuedAt: Date | string;
  expiresAt: Date | string | null;
  company: {
    name: string;
    street: string | null;
    zipCode: string | null;
    city: string | null;
    state: string | null;
    country: string | null;
    vatNumber: string | null;
  } | null;
  contact: { firstName: string | null; lastName: string | null } | null;
  owner: { name: string | null } | null;
  items: {
    description: string | null;
    quantity: number;
    unitPrice: string | null;
    discountPercent: string | null;
    taxPercent: string | null;
    totalPrice: string | null;
    product: { name: string } | null;
  }[];
}

const INK: Hex = "#111827";
const MUTED: Hex = "#6b7280";
const ACCENT: Hex = "#2563eb";

const BADGE: Record<string, { bg: Hex; fg: Hex }> = {
  draft: { bg: "#f1f5f9", fg: "#475569" },
  sent: { bg: "#eff6ff", fg: "#1d4ed8" },
  viewed: { bg: "#f5f3ff", fg: "#6d28d9" },
  accepted: { bg: "#f0fdf4", fg: "#15803d" },
  declined: { bg: "#fef2f2", fg: "#dc2626" },
  expired: { bg: "#fffbeb", fg: "#d97706" },
  converted: { bg: "#f0fdfa", fg: "#0f766e" },
};

const MARGIN = 48;

export async function renderQuotePdf(input: {
  quote: QuotePdfInput;
  seller: SellerIdentity;
  lang: DocumentLanguage;
}): Promise<Uint8Array> {
  const { quote, seller, lang } = input;
  const tx = QUOTE_TEXT[lang];
  const money = (v: string | number | null | undefined) => formatDocumentMoney(v, quote.currency, lang);
  const pct = (v: string | number | null | undefined) => formatDocumentPercent(v, lang);
  const qty = (n: number) => new Intl.NumberFormat(DOCUMENT_LOCALE[lang], { maximumFractionDigits: 3 }).format(n);

  // Columns: description takes what the numbers leave.
  const widths = { qty: 40, unit: 78, disc: 52, tax: 46, total: 82 };
  const cols = (c: Canvas) => {
    const x = c.left;
    const desc = c.contentWidth - (widths.qty + widths.unit + widths.disc + widths.tax + widths.total);
    return {
      desc: { x, w: desc - 8 },
      qty: { x: x + desc, w: widths.qty },
      unit: { x: x + desc + widths.qty, w: widths.unit },
      disc: { x: x + desc + widths.qty + widths.unit, w: widths.disc },
      tax: { x: x + desc + widths.qty + widths.unit + widths.disc, w: widths.tax },
      total: { x: x + desc + widths.qty + widths.unit + widths.disc + widths.tax, w: widths.total },
    };
  };

  const tableHeader = (c: Canvas) => {
    const k = cols(c);
    const th = { size: 7.5, bold: true, color: MUTED };
    c.text(tx.description.toUpperCase(), k.desc.x, c.y, th);
    c.text(tx.quantity.toUpperCase(), k.qty.x, c.y, { ...th, align: "right", width: k.qty.w });
    c.text(tx.unitPrice.toUpperCase(), k.unit.x, c.y, { ...th, align: "right", width: k.unit.w });
    c.text(tx.discount.toUpperCase(), k.disc.x, c.y, { ...th, align: "right", width: k.disc.w });
    c.text(tx.tax.toUpperCase(), k.tax.x, c.y, { ...th, align: "right", width: k.tax.w });
    c.text(tx.lineTotal.toUpperCase(), k.total.x, c.y, { ...th, align: "right", width: k.total.w });
    c.y += 13;
    c.line(c.left, c.y, c.right, c.y, { thickness: 1.2, color: INK });
    c.y += 3;
  };

  let inTable = false;
  const c = await createCanvas({
    title: `${tx.documentTitle} ${quote.quoteNumber}`,
    author: seller.name,
    subject: tx.subtitle,
    language: lang,
    marginX: MARGIN,
    marginTop: MARGIN,
    marginBottom: 64,
    onNewPage: (cv) => {
      if (inTable) tableHeader(cv);
    },
  });

  // ── Header ──
  const headTop = c.y;
  c.text(seller.name, c.left, c.y, { size: 18, bold: true });
  c.y += 24;
  for (const l of [
    seller.address,
    seller.vatNumber ? `${tx.vat} ${seller.vatNumber}` : null,
    [seller.email, seller.phone].filter(Boolean).join(" · ") || null,
  ]) {
    if (!l) continue;
    c.paragraph(l, c.left, 300, { size: 9, color: MUTED, lineHeight: 12 });
  }
  const leftBottom = c.y;

  let ry = headTop;
  c.text(tx.documentTitle.toUpperCase(), c.left, ry, { size: 9, color: MUTED, align: "right", width: c.contentWidth });
  ry += 13;
  c.text(quote.quoteNumber, c.left, ry, { size: 16, bold: true, align: "right", width: c.contentWidth });
  ry += 22;
  const badge = BADGE[quote.status] ?? BADGE.draft;
  const label = quoteStatusText(quote.status, lang).toUpperCase();
  const bw = c.width(label, { size: 7.5, bold: true }) + 14;
  c.rect(c.right - bw, ry, bw, 14, { fill: badge.bg });
  c.text(label, c.right - bw + 7, ry + 3.5, { size: 7.5, bold: true, color: badge.fg });
  ry += 14;
  c.y = Math.max(leftBottom, ry) + 26;

  // ── Customer and details ──
  const infoTop = c.y;
  const half = c.contentWidth / 2 - 16;
  c.text(tx.billTo.toUpperCase(), c.left, c.y, { size: 7.5, bold: true, color: MUTED });
  c.y += 13;
  const company = quote.company;
  const contactName = quote.contact ? `${quote.contact.firstName ?? ""} ${quote.contact.lastName ?? ""}`.trim() : "";
  if (company) c.paragraph(company.name, c.left, half, { size: 10, bold: true, lineHeight: 13 });
  const cityLine = company ? [company.zipCode, company.city, company.state].filter(Boolean).join(" ") : "";
  for (const l of [
    contactName ? `${tx.contactPerson}: ${contactName}` : null,
    company?.street ?? null,
    cityLine || null,
    company?.country ?? null,
  ]) {
    if (l) c.paragraph(l, c.left, half, { size: 10, lineHeight: 13 });
  }
  if (company?.vatNumber) {
    c.y += 3;
    c.paragraph(`${tx.vat} ${company.vatNumber}`, c.left, half, { size: 10, color: MUTED, lineHeight: 13 });
  }
  const billBottom = c.y;

  let dy = infoTop;
  const rightX = c.left + c.contentWidth / 2;
  const rightW = c.contentWidth / 2;
  c.text(tx.details.toUpperCase(), rightX, dy, { size: 7.5, bold: true, color: MUTED, align: "right", width: rightW });
  dy += 13;
  const detail = (labelText: string, value: string) => {
    const valueW = c.width(value, { size: 10, bold: true });
    c.text(value, rightX, dy, { size: 10, bold: true, align: "right", width: rightW });
    c.text(`${labelText} `, rightX, dy, { size: 10, color: MUTED, align: "right", width: rightW - valueW });
    dy += 13;
  };
  detail(tx.issued, formatDocumentDate(quote.issuedAt, lang));
  if (quote.expiresAt) detail(tx.expires, formatDocumentDate(quote.expiresAt, lang));
  if (quote.owner?.name) detail(`${tx.reference}:`, quote.owner.name);

  c.y = Math.max(billBottom, dy) + 18;
  c.line(c.left, c.y, c.right, c.y);
  c.y += 16;

  // ── Lines ──
  tableHeader(c);
  inTable = true;
  quote.items.forEach((item, i) => {
    const k = cols(c);
    const description = item.description || item.product?.name || "—";
    const descLines = c.wrap(description, k.desc.w, { size: 10 });
    const sub =
      item.product && item.product.name !== item.description ? c.wrap(item.product.name, k.desc.w, { size: 8 }) : [];
    const height = Math.max(22, 8 + descLines.length * 13 + sub.length * 10);
    c.ensure(height);
    const top = c.y;
    if (i % 2 === 1) c.rect(c.left, top, c.contentWidth, height, { fill: "#f9fafb" });
    let ly = top + 6;
    for (const l of descLines) {
      c.text(l, k.desc.x, ly, { size: 10 });
      ly += 13;
    }
    for (const l of sub) {
      c.text(l, k.desc.x, ly, { size: 8, color: MUTED });
      ly += 10;
    }
    const num = { size: 10, align: "right" as const };
    c.text(qty(item.quantity), k.qty.x, top + 6, { ...num, width: k.qty.w });
    c.text(money(item.unitPrice), k.unit.x, top + 6, { ...num, width: k.unit.w });
    c.text(Number.parseFloat(item.discountPercent ?? "0") > 0 ? pct(item.discountPercent) : "-", k.disc.x, top + 6, {
      ...num,
      width: k.disc.w,
    });
    c.text(Number.parseFloat(item.taxPercent ?? "0") > 0 ? pct(item.taxPercent) : "-", k.tax.x, top + 6, {
      ...num,
      width: k.tax.w,
    });
    c.text(money(item.totalPrice), k.total.x, top + 6, { ...num, bold: true, width: k.total.w });
    c.y = top + height;
    c.line(c.left, c.y, c.right, c.y);
  });
  inTable = false;

  // ── Totals ──
  const discountAmt = Number.parseFloat(quote.discountAmount ?? "0");
  const taxAmt = Number.parseFloat(quote.taxAmount ?? "0");
  const rows: [string, string, Hex?][] = [[tx.subtotal, money(quote.subtotal)]];
  if (discountAmt > 0)
    rows.push([`${tx.discountOn} (${pct(quote.discountPercent)})`, `-${money(discountAmt)}`, "#d97706"]);
  if (taxAmt > 0) {
    const rate = Number.parseFloat(quote.taxPercent ?? "0") > 0 ? ` (${pct(quote.taxPercent)})` : "";
    rows.push([`${tx.taxOn}${rate}`, `+${money(taxAmt)}`, "#475569"]);
  }
  const boxW = 230;
  const boxX = c.right - boxW;
  c.ensure(rows.length * 16 + 40);
  c.y += 10;
  for (const [l, v, col] of rows) {
    c.text(l, boxX, c.y, { size: 10, color: MUTED });
    c.text(v, boxX, c.y, { size: 10, bold: true, color: col ?? INK, align: "right", width: boxW });
    c.y += 16;
  }
  c.line(boxX, c.y + 2, c.right, c.y + 2, { thickness: 1.2, color: INK });
  c.y += 10;
  c.text(tx.total, boxX, c.y, { size: 13, bold: true });
  c.text(money(quote.totalAmount), boxX, c.y, { size: 13, bold: true, color: ACCENT, align: "right", width: boxW });
  c.y += 26;

  // ── Notes ──
  if (quote.notes) {
    c.ensure(50);
    c.line(c.left, c.y, c.right, c.y);
    c.y += 14;
    c.text(tx.notes.toUpperCase(), c.left, c.y, { size: 7.5, bold: true, color: MUTED });
    c.y += 14;
    c.paragraph(quote.notes, c.left, c.contentWidth, { size: 10, color: "#374151", lineHeight: 15 });
  }

  const generated = `${tx.generated} ${formatDocumentDate(new Date(), lang)}`;
  return c.save((cv, i, count) => {
    const y = 841.89 - 40;
    cv.line(cv.left, y, cv.right, y);
    const small = { size: 8, color: MUTED };
    cv.text(`${seller.name} · ${quote.quoteNumber}`, cv.left, y + 8, small);
    const gw = cv.width(generated, small);
    cv.text(generated, cv.left + (cv.contentWidth - gw) / 2, y + 8, small);
    cv.text(`${tx.page} ${i + 1} / ${count}`, cv.left, y + 8, { ...small, align: "right", width: cv.contentWidth });
  });
}
