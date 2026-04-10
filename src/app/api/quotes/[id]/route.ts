import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { quotes } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { id } = await params;

  const q = await db.query.quotes.findFirst({
    where: eq(quotes.id, id),
    with: {
      deal:    true,
      company: true,
      contact: true,
      owner:   true,
      items: { with: { product: true } },
    },
  });

  if (!q) return new NextResponse("Not found", { status: 404 });

  const canView =
    session.user.id === q.ownerId ||
    session.user.id === q.deal?.ownerId ||
    session.user.role === "admin" ||
    session.user.role === "owner";

  if (!canView) return new NextResponse("Forbidden", { status: 403 });

  const contactName = q.contact
    ? `${q.contact.firstName} ${q.contact.lastName}`.trim()
    : null;

  // q is guaranteed non-null here (guarded above); non-null assertion needed
  // because TypeScript can't narrow through closure boundaries.
  const currency = q!.currency;
  function money(value: string | null) {
    return `${currency} ${parseFloat(value ?? "0").toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }

  const issueDate = new Date(q.issuedAt).toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });
  const expiryDate = q.expiresAt
    ? new Date(q.expiresAt).toLocaleDateString("en-US", {
        year: "numeric", month: "long", day: "numeric",
      })
    : null;

  const itemRows = q.items.map((item) => `
    <tr>
      <td class="td-left">
        <strong>${esc(item.description)}</strong>
        ${item.product ? `<br><span class="sub">${esc(item.product.name)}</span>` : ""}
      </td>
      <td class="td-right">${item.quantity}</td>
      <td class="td-right">${money(item.unitPrice)}</td>
      <td class="td-right">${parseFloat(item.discountPercent ?? "0") > 0 ? `${item.discountPercent}%` : "—"}</td>
      <td class="td-right">${parseFloat(item.taxPercent ?? "0") > 0 ? `${item.taxPercent}%` : "—"}</td>
      <td class="td-right bold">${money(item.totalPrice)}</td>
    </tr>`).join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Quote ${esc(q.quoteNumber)}</title>
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
      Print / Save as PDF
    </button>
  </div>

  <div class="header">
    <div>
      <div class="brand">Flux CRM</div>
      <div class="brand-sub">Quote &amp; Proposal</div>
    </div>
    <div class="meta">
      <div class="quote-num">${esc(q.quoteNumber)}</div>
      <div class="badge ${esc(q.status)}">${esc(q.status)}</div>
    </div>
  </div>

  <div class="two-col">
    <div>
      <div class="section-label">Customer</div>
      <div class="section-value">
        <strong>${esc(q.company?.name ?? "—")}</strong>
        ${contactName ? `<br>${esc(contactName)}` : ""}
      </div>
    </div>
    <div style="text-align:right">
      <div class="section-label">Details</div>
      <div class="section-value">
        <div>Issued: <strong>${issueDate}</strong></div>
        ${expiryDate ? `<div>Expires: <strong>${expiryDate}</strong></div>` : ""}
        ${q.deal ? `<div>Deal: <strong>${esc(q.deal.name)}</strong></div>` : ""}
        ${q.owner?.name ? `<div>Owner: <strong>${esc(q.owner.name)}</strong></div>` : ""}
      </div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Description</th>
        <th style="text-align:right">Qty</th>
        <th style="text-align:right">Unit Price</th>
        <th style="text-align:right">Discount</th>
        <th style="text-align:right">Tax</th>
        <th style="text-align:right">Total</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>

  <div class="totals">
    <div class="totals-inner">
      <div class="totals-row">
        <span class="label">Subtotal</span>
        <span class="value">${money(q.subtotal)}</span>
      </div>
      ${parseFloat(q.discountAmount ?? "0") > 0 ? `
      <div class="totals-row discount">
        <span class="label">Discount (${q.discountPercent}%)</span>
        <span class="value">−${money(q.discountAmount)}</span>
      </div>` : ""}
      ${parseFloat(q.taxAmount ?? "0") > 0 ? `
      <div class="totals-row tax">
        <span class="label">Tax (${q.taxPercent}%)</span>
        <span class="value">+${money(q.taxAmount)}</span>
      </div>` : ""}
      <div class="totals-row total">
        <span class="label">Total</span>
        <span class="value">${money(q.totalAmount)}</span>
      </div>
    </div>
  </div>

  ${q.notes ? `
  <div class="notes">
    <div class="section-label">Notes</div>
    <p style="margin-top:6px;color:#444;white-space:pre-wrap">${esc(q.notes)}</p>
  </div>` : ""}

  <div class="footer">
    Generated by Flux CRM &nbsp;·&nbsp; ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
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
