import { isDay } from "@/lib/contract-terms";
import { normaliseVat } from "@/lib/fiscal-ids";
import { isValidSeries, NATURE_CODES } from "@/lib/invoice-rules";

/**
 * A draft invoice: made from an order, edited by a person, frozen when issued.
 */

export interface DraftLineInput {
  productId?: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  discountPercent?: number | null;
  taxPercent: number;
  nature?: string | null;
}

export interface DraftInput {
  series: string;
  dueDate?: string | null;
  discountPercent: number;
  stampDutyMode: string;
  stampDutyNote?: string | null;
  paymentMethod: string;
  notes?: string | null;
  lines: DraftLineInput[];
}

/** FatturaPA ModalitaPagamento codes offered on a draft. */
export const PAYMENT_METHODS: Record<string, string> = {
  MP01: "Contanti",
  MP02: "Assegno",
  MP05: "Bonifico",
  MP08: "Carta di pagamento",
  MP12: "RIBA",
  MP19: "SEPA Direct Debit",
  MP23: "PagoPA",
};

/**
 * The lines of an order, as the lines of an invoice.
 *
 * The description is the order line's own, then the product name, and never empty:
 * an invoice line with no description is refused by SDI, and a one-off line on an
 * order has no product to fall back on.
 */
export function linesFromOrder(
  items: readonly {
    productId: string | null;
    description: string | null;
    productName: string | null;
    quantity: number;
    unitPrice: string | number;
    discountPercent: string | number | null;
    taxPercent: string | number | null;
  }[],
): DraftLineInput[] {
  return items.map((i) => ({
    productId: i.productId,
    description: i.description?.trim() || i.productName?.trim() || "",
    quantity: Number(i.quantity),
    unitPrice: Number(i.unitPrice),
    discountPercent: Number(i.discountPercent ?? 0),
    taxPercent: Number(i.taxPercent ?? 0),
    nature: null,
  }));
}

/** An edited draft as it will be stored, or the reason it cannot be. */
export function cleanDraft(input: DraftInput): { ok: true; value: DraftInput } | { ok: false; error: string } {
  const series = input.series.trim().toUpperCase();
  if (!isValidSeries(series)) return { ok: false, error: "The series is letters and digits, up to 10." };
  const dueDate = input.dueDate || null;
  if (dueDate && !isDay(dueDate)) return { ok: false, error: "The due date is not a valid date." };
  const discountPercent = Number(input.discountPercent) || 0;
  if (discountPercent < 0 || discountPercent > 100) return { ok: false, error: "The discount is between 0 and 100%." };
  if (!Object.hasOwn(PAYMENT_METHODS, input.paymentMethod)) return { ok: false, error: "Unknown payment method." };
  if (!["auto", "force_on", "force_off"].includes(input.stampDutyMode)) {
    return { ok: false, error: "Unknown stamp duty setting." };
  }
  if (input.lines.length > 200) return { ok: false, error: "An invoice has at most 200 lines." };

  const lines: DraftLineInput[] = [];
  for (const [i, l] of input.lines.entries()) {
    const n = i + 1;
    const quantity = Number(l.quantity);
    const unitPrice = Number(l.unitPrice);
    const lineDiscount = Number(l.discountPercent ?? 0);
    const taxPercent = Number(l.taxPercent);
    if (!(Number.isFinite(quantity) && quantity >= 0 && quantity < 1e9))
      return { ok: false, error: `Line ${n}: quantity.` };
    if (!(Number.isFinite(unitPrice) && unitPrice >= 0 && unitPrice < 1e10))
      return { ok: false, error: `Line ${n}: price.` };
    if (!(lineDiscount >= 0 && lineDiscount <= 100)) return { ok: false, error: `Line ${n}: discount.` };
    if (!(taxPercent >= 0 && taxPercent <= 100)) return { ok: false, error: `Line ${n}: VAT rate.` };
    const nature = l.nature?.trim() || null;
    if (nature && !Object.hasOwn(NATURE_CODES, nature)) return { ok: false, error: `Line ${n}: unknown Natura code.` };
    lines.push({
      productId: l.productId || null,
      description: l.description.trim().slice(0, 1000),
      quantity: Math.round(quantity * 1000) / 1000,
      unitPrice: Math.round(unitPrice * 100) / 100,
      discountPercent: Math.round(lineDiscount * 100) / 100,
      taxPercent: Math.round(taxPercent * 100) / 100,
      // A Natura code on a taxed line is kept as typed: the issue check names it,
      // rather than the save quietly throwing away what somebody chose.
      nature,
    });
  }

  return {
    ok: true,
    value: {
      series,
      dueDate,
      discountPercent: Math.round(discountPercent * 100) / 100,
      stampDutyMode: input.stampDutyMode,
      // Kept only while it means something: back on automatic, the old reason is noise.
      stampDutyNote: input.stampDutyMode === "auto" ? null : input.stampDutyNote?.trim().slice(0, 500) || null,
      paymentMethod: input.paymentMethod,
      notes: input.notes?.trim().slice(0, 2000) || null,
      lines,
    },
  };
}

/**
 * Today in Italy, as a calendar day.
 *
 * ⚠️ Not UTC. An invoice issued at half past midnight on 1 January in Rome is dated
 * 1 January, belongs to the new year and starts its numbering at 1. In UTC it would
 * still be 31 December and take the next number of the old year.
 */
export function italianToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** The customer as the invoice will state it, frozen at issue. */
export function customerSnapshot(c: {
  name: string | null;
  vatNumber: string | null;
  fiscalCode: string | null;
  sdiCode: string | null;
  pec: string | null;
  street: string | null;
  zipCode: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
}) {
  return {
    name: c.name,
    vatNumber: c.vatNumber ? normaliseVat(c.vatNumber) : null,
    fiscalCode: c.fiscalCode?.replace(/\s+/g, "").toUpperCase() || null,
    sdiCode: c.sdiCode?.trim().toUpperCase() || null,
    pec: c.pec?.trim().toLowerCase() || null,
    street: c.street,
    zipCode: c.zipCode,
    city: c.city,
    province: c.state?.trim().toUpperCase() || null,
    country: c.country,
  };
}
