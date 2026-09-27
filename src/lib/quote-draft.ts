/**
 * A draft quote proposed by an integration (V3.1 F5, decision D-A): «the model says the lines,
 * the code says the prices».
 *
 * ⚠️⚠️ **Every line names a product, and Flux prices it.** The caller — an AI assistant — says
 * which products and how many; the unit price and the tax come from the catalogue under the
 * customer's price list, by the same rule as the salesperson's form (src/lib/price-list.ts).
 * A line without a product would be a price somebody made up, so it is refused.
 *
 * ⚠️⚠️ **A draft, and nothing more.** It is never sent: status `draft`, owned by the deal's
 * owner, who is told it is there. Sending it to the customer is a person's decision, taken
 * from the quote page like any other quote.
 */
import crypto from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";

import { contacts, deals, products, quoteActivities, quoteItems, quotes } from "@/db/schema";
import { computeDocument } from "@/lib/document-totals";
import { priceFor } from "@/lib/price-list";
import { loadCompanyPriceRules } from "@/lib/price-rules-load";
import { generateQuoteNumber } from "@/lib/quote-number";
import { defaultExpiry, readQuoteDefaults } from "@/lib/workspace-preferences";

// biome-ignore lint/suspicious/noExplicitAny: Drizzle's database types differ per driver
type AnyDb = any;

export const DRAFT_MAX_LINES = 100;

export interface DraftInput {
  dealId: string;
  contactId: string | null;
  notes: string | null;
  lines: { productId: string; quantity: number; note: string | null }[];
}

export type FieldError = { field: string; message: string };

/** The body, checked without the database. */
export function readDraftInput(
  body: Record<string, unknown>,
): { ok: true; value: DraftInput } | { ok: false; errors: FieldError[] } {
  const errors: FieldError[] = [];
  const dealId = typeof body.dealId === "string" ? body.dealId.trim() : "";
  if (!dealId) errors.push({ field: "dealId", message: "dealId is required" });
  const contactId = typeof body.contactId === "string" && body.contactId.trim() ? body.contactId.trim() : null;
  const notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim().slice(0, 5000) : null;

  const raw = Array.isArray(body.lines) ? body.lines : null;
  if (!raw || raw.length === 0) errors.push({ field: "lines", message: "At least one line" });
  else if (raw.length > DRAFT_MAX_LINES) errors.push({ field: "lines", message: `At most ${DRAFT_MAX_LINES} lines` });
  const lines: DraftInput["lines"] = [];
  for (const [i, line] of (raw ?? []).entries()) {
    const l = (line ?? {}) as Record<string, unknown>;
    const productId = typeof l.productId === "string" ? l.productId.trim() : "";
    const quantity = typeof l.quantity === "number" ? l.quantity : Number.NaN;
    if (!productId) {
      errors.push({
        field: `lines[${i}].productId`,
        message: "Every line names a product: prices come from the catalogue",
      });
    }
    // Whole units: a quote line's quantity is an integer column, and 1.5 used to reach it and
    // come back as a 500 after the idempotency key had been claimed.
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 1_000_000) {
      errors.push({ field: `lines[${i}].quantity`, message: "quantity must be a positive whole number" });
    }
    const note = typeof l.note === "string" && l.note.trim() ? l.note.trim().slice(0, 500) : null;
    lines.push({ productId, quantity, note });
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: { dealId, contactId, notes, lines } };
}

export type DraftResult =
  | {
      ok: true;
      quoteId: string;
      quoteNumber: string;
      ownerId: string | null;
      total: number;
      lines: { productId: string; description: string; quantity: number; unitPrice: number; taxPercent: number }[];
    }
  | { ok: false; status: 404 | 422; errors: FieldError[] };

/** Writes the draft: header, lines and a «proposed» event, together. */
export async function draftQuote(db: AnyDb, input: DraftInput, now: Date = new Date()): Promise<DraftResult> {
  const [deal] = await db
    .select({ id: deals.id, companyId: deals.companyId, contactId: deals.contactId, ownerId: deals.ownerId })
    .from(deals)
    .where(eq(deals.id, input.dealId));
  if (!deal) return { ok: false, status: 404, errors: [{ field: "dealId", message: "No deal with that id" }] };
  if (!deal.companyId) {
    return { ok: false, status: 422, errors: [{ field: "dealId", message: "The deal has no company to quote" }] };
  }
  // ⚠️ The person the quote is addressed to must exist and belong to the customer: an unknown
  // id was a 500, and somebody at another company would have been sent this one's prices.
  if (input.contactId) {
    const [contact] = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.id, input.contactId), eq(contacts.companyId, deal.companyId)));
    if (!contact) {
      return {
        ok: false,
        status: 422,
        errors: [{ field: "contactId", message: "No contact with that id at the deal's company" }],
      };
    }
  }

  const ids = [...new Set(input.lines.map((l) => l.productId))];
  const found: { id: string; name: string; price: string; taxPercent: string | null; isActive: boolean }[] = await db
    .select({
      id: products.id,
      name: products.name,
      price: products.price,
      taxPercent: products.taxPercent,
      isActive: products.isActive,
    })
    .from(products)
    .where(inArray(products.id, ids));
  const byId = new Map(found.map((p) => [p.id, p]));
  const unknown = input.lines
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => !byId.get(l.productId)?.isActive)
    .map(({ i }) => ({ field: `lines[${i}].productId`, message: "No active product with that id" }));
  if (unknown.length) return { ok: false, status: 422, errors: unknown };

  // The customer's own prices, by the rule the salesperson's form follows.
  const rules = await loadCompanyPriceRules(db, deal.companyId);
  const priced = input.lines.map((l) => {
    const p = byId.get(l.productId) as (typeof found)[number];
    return {
      productId: p.id,
      description: l.note ? `${p.name} — ${l.note}` : p.name,
      quantity: l.quantity,
      unitPrice: priceFor(p.id, p.price, rules),
      taxPercent: Number(p.taxPercent ?? 0),
    };
  });
  const totals = computeDocument({
    lines: priced.map((l) => ({
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discountPercent: 0,
      taxPercent: l.taxPercent,
    })),
    discountPercent: 0,
  });

  const defaults = await readQuoteDefaults(db);
  const quoteId = crypto.randomUUID();
  const quoteNumber = generateQuoteNumber(now);
  const header = {
    id: quoteId,
    quoteNumber,
    dealId: deal.id,
    companyId: deal.companyId,
    contactId: input.contactId ?? deal.contactId ?? null,
    ownerId: deal.ownerId ?? null,
    status: "draft",
    // Catalogue prices carry no currency of their own; the workspace's is euro.
    currency: "EUR",
    eurRate: "1",
    subtotal: totals.subtotal.toString(),
    discountAmount: totals.discountAmount.toString(),
    discountPercent: "0",
    taxAmount: totals.taxAmount.toString(),
    taxPercent: "0",
    totalAmount: totals.total.toString(),
    expiresAt: defaultExpiry(now, defaults.validityDays),
    notes: input.notes ?? (defaults.terms || null),
  };
  const items = priced.map((l, i) => ({
    quoteId,
    productId: l.productId,
    description: l.description,
    quantity: l.quantity,
    unitPrice: l.unitPrice.toString(),
    discountPercent: "0",
    discountAmount: totals.lines[i].discountAmount.toString(),
    taxPercent: totals.lines[i].taxPercent.toString(),
    taxAmount: totals.lines[i].taxAmount.toString(),
    totalPrice: totals.lines[i].total.toString(),
  }));
  const statements = (h: AnyDb) => [
    h.insert(quotes).values(header),
    h.insert(quoteItems).values(items),
    // «Proposed», not «created»: the quote page and the timeline say it came from outside.
    h
      .insert(quoteActivities)
      .values({ quoteId, type: "proposed" }),
  ];

  // ⚠️ Together or not at all: header without lines is a quote whose totals describe nothing.
  // The HTTP driver has no transaction but a batch; a pooled or in-process one has transactions.
  if (typeof db.batch === "function") await db.batch(statements(db));
  else {
    await db.transaction(async (tx: AnyDb) => {
      for (const statement of statements(tx)) await statement;
    });
  }

  return { ok: true, quoteId, quoteNumber, ownerId: deal.ownerId ?? null, total: totals.total, lines: priced };
}
