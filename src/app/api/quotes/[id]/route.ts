import { type NextRequest, NextResponse } from "next/server";

import { eq } from "drizzle-orm";

import { auth } from "@/auth";
import { quotes } from "@/db/schema";
import { getActor } from "@/lib/auth-guard";
import {
  documentLanguage,
  formatDocumentDate,
  formatDocumentMoney,
  formatDocumentPercent,
  QUOTE_TEXT,
  quoteStatusText,
} from "@/lib/document-language";
import { can } from "@/lib/permissions";
import { sellerIdentity } from "@/lib/seller-identity";
import { getDb } from "@/lib/tenant-context";
import { USER_SUMMARY_COLUMNS } from "@/lib/user-columns";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { id } = await params;
  const db = await getDb();

  const q = await db.query.quotes.findFirst({
    where: eq(quotes.id, id),
    with: {
      deal: true,
      company: true,
      contact: true,
      owner: { columns: USER_SUMMARY_COLUMNS },
      items: { with: { product: true } },
    },
  });

  if (!q) return new NextResponse("Not found", { status: 404 });

  // ⚠️ The WORKSPACE role, not the platform one: the last two lines read
  // `session.user.role`, which is "user" for every customer, so no workspace admin could
  // open a colleague's quote.
  const canView =
    session.user.id === q.ownerId || session.user.id === q.deal?.ownerId || can(await getActor(), "user:read");

  if (!canView) return new NextResponse("Forbidden", { status: 403 });

  const contactName = q.contact ? `${q.contact.firstName} ${q.contact.lastName}`.trim() : null;

  // The customer's language and the quote's own currency: this page is what gets printed and sent.
  const lang = documentLanguage(q.company);
  const tx = QUOTE_TEXT[lang];
  const currency = q.currency;
  const money = (value: string | number | null) => formatDocumentMoney(value, currency, lang);
  const pct = (value: string | null) => formatDocumentPercent(value, lang);
  const seller = await sellerIdentity(db);
  const issueDate = formatDocumentDate(q.issuedAt, lang);
  const expiryDate = q.expiresAt ? formatDocumentDate(q.expiresAt, lang) : null;

  const itemRows = q.items
    .map(
      (item) => `
    <tr>
      <td class="td-left">
        <strong>${esc(item.description)}</strong>
        ${item.product ? `<br><span class="sub">${esc(item.product.name)}</span>` : ""}
      </td>
      <td class="td-right">${item.quantity}</td>
      <td class="td-right">${money(item.unitPrice)}</td>
      <td class="td-right">${parseFloat(item.discountPercent ?? "0") > 0 ? pct(item.discountPercent) : "—"}</td>
      <td class="td-right">${parseFloat(item.taxPercent ?? "0") > 0 ? pct(item.taxPercent) : "—"}</td>
      <td class="td-right bold">${money(item.totalPrice)}</td>
    </tr>`,
    )
    .join("");

  const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(tx.documentTitle)} ${esc(q.quoteNumber)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #111; background: #fff; padding: 40px; font-size: 14px; line-height: 1.5; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; }
    .brand { font-size: 22px; font-weight: 700; color: #111; }
    .brand-sub { color: #666; font-size: 12px; margin-top: 2px; }
    .meta { text-align: right; }
    .meta .quote-num { font-size: 20px; font-weight: 700; font-family: monospace; }
    .badge { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 4px; background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; }
    .badge.draft { background: #f8fafc; color: #475569; border-color: #cbd5e1; }
    .badge.sent, .badge.viewed { background: #eff6ff; color: #1d4ed8; border-color: #bfdbfe; }
    .badge.declined { background: #fef2f2; color: #991b1b; border-color: #fecaca; }
    .badge.expired { background: #fffbeb; color: #92400e; border-color: #fde68a; }
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; margin-bottom: 32px; }
    .section-label { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: #888; margin-bottom: 6px; }
    .section-value { font-size: 14px; color: #111; }
    .section-value strong { font-weight: 600; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
    th { text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #666; padding: 8px 12px; border-bottom: 2px solid #e5e7eb; }
    td { padding: 10px 12px; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
    .td-right { text-align: right; }
    .td-left { text-align: left; }
    .bold { font-weight: 600; }
    .sub { font-size: 12px; color: #888; }
    .totals { display: flex; justify-content: flex-end; margin-top: 4px; }
    .totals-inner { width: 280px; }
    .totals-row { display: flex; justify-content: space-between; padding: 5px 0; font-size: 13px; }
    .totals-row .label { color: #666; }
    .totals-row .value { font-weight: 500; font-variant-numeric: tabular-nums; }
    .totals-row.discount .value { color: #d97706; }
    .totals-row.tax .value { color: #475569; }
    .totals-row.total { border-top: 2px solid #111; margin-top: 6px; padding-top: 10px; }
    .totals-row.total .label { font-weight: 700; font-size: 15px; }
    .totals-row.total .value { font-weight: 800; font-size: 18px; }
    .notes { margin-top: 32px; padding-top: 24px; border-top: 1px solid #e5e7eb; }
    .footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #aaa; text-align: center; }
    @media print {
      body { padding: 24px; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>

  <div class="no-print" style="text-align:right;margin-bottom:20px;">
    <button onclick="window.print()" style="padding:8px 18px;background:#111;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;">
      ${esc(tx.print)}
    </button>
  </div>

  <div class="header">
    <div>
      <div class="brand">${esc(seller.name)}</div>
      ${seller.address ? `<div class="brand-sub">${esc(seller.address)}</div>` : ""}
      ${seller.vatNumber ? `<div class="brand-sub">${esc(tx.vat)} ${esc(seller.vatNumber)}</div>` : ""}
    </div>
    <div class="meta">
      <div class="brand-sub">${esc(tx.documentTitle)}</div>
      <div class="quote-num">${esc(q.quoteNumber)}</div>
      <div class="badge ${esc(q.status)}">${esc(quoteStatusText(q.status, lang))}</div>
    </div>
  </div>

  <div class="two-col">
    <div>
      <div class="section-label">${esc(tx.billTo)}</div>
      <div class="section-value">
        <strong>${esc(q.company?.name ?? "—")}</strong>
        ${contactName ? `<br>${esc(tx.contactPerson)}: ${esc(contactName)}` : ""}
        ${q.company?.vatNumber ? `<br><span class="sub">${esc(tx.vat)} ${esc(q.company.vatNumber)}</span>` : ""}
      </div>
    </div>
    <div style="text-align:right">
      <div class="section-label">${esc(tx.details)}</div>
      <div class="section-value">
        <div>${esc(tx.issued)} <strong>${issueDate}</strong></div>
        ${expiryDate ? `<div>${esc(tx.expires)} <strong>${expiryDate}</strong></div>` : ""}
        ${q.owner?.name ? `<div>${esc(tx.reference)}: <strong>${esc(q.owner.name)}</strong></div>` : ""}
      </div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>${esc(tx.description)}</th>
        <th style="text-align:right">${esc(tx.quantity)}</th>
        <th style="text-align:right">${esc(tx.unitPrice)}</th>
        <th style="text-align:right">${esc(tx.discount)}</th>
        <th style="text-align:right">${esc(tx.tax)}</th>
        <th style="text-align:right">${esc(tx.lineTotal)}</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>

  <div class="totals">
    <div class="totals-inner">
      <div class="totals-row">
        <span class="label">${esc(tx.subtotal)}</span>
        <span class="value">${money(q.subtotal)}</span>
      </div>
      ${
        parseFloat(q.discountAmount ?? "0") > 0
          ? `
      <div class="totals-row discount">
        <span class="label">${esc(tx.discountOn)} (${pct(q.discountPercent)})</span>
        <span class="value">−${money(q.discountAmount)}</span>
      </div>`
          : ""
      }
      ${
        parseFloat(q.taxAmount ?? "0") > 0
          ? `
      <div class="totals-row tax">
        <span class="label">${esc(tx.taxOn)}${parseFloat(q.taxPercent ?? "0") > 0 ? ` (${pct(q.taxPercent)})` : ""}</span>
        <span class="value">+${money(q.taxAmount)}</span>
      </div>`
          : ""
      }
      <div class="totals-row total">
        <span class="label">${esc(tx.total)}</span>
        <span class="value">${money(q.totalAmount)}</span>
      </div>
    </div>
  </div>

  ${
    q.notes
      ? `
  <div class="notes">
    <div class="section-label">${esc(tx.notes)}</div>
    <p style="margin-top:6px;color:#444;white-space:pre-wrap">${esc(q.notes)}</p>
  </div>`
      : ""
  }

  <div class="footer">
    ${esc(seller.name)} &nbsp;·&nbsp; ${esc(tx.generated)} ${formatDocumentDate(new Date(), lang)}
  </div>

</body>
</html>`;

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function esc(str: string | null | undefined): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
