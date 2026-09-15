import { computeDocument, round2 } from "@/lib/document-totals";

/**
 * The rules of an invoice that do not depend on how it reaches SDI.
 *
 * Perimeter decided on 15 September 2026 (D2, D3): TD01 invoices and TD04 credit
 * notes, ordinary VAT with a Natura code on every zero-rate line, virtual stamp
 * duty; one invoice per order. Split payment, withholding tax and reverse charge
 * are a later version, and nothing here pretends to handle them.
 */

export const DOCUMENT_TYPES = ["TD01", "TD04"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/**
 * Natura IVA, FatturaPA 1.2.2. A line at 0% must say why it carries no VAT; a line
 * with VAT must not have one. SDI rejects either mistake.
 */
export const NATURE_CODES: Record<string, string> = {
  N1: "Escluse ex art. 15",
  "N2.1": "Non soggette ad IVA ai sensi degli artt. da 7 a 7-septies del DPR 633/72",
  "N2.2": "Non soggette – altri casi",
  "N3.1": "Non imponibili – esportazioni",
  "N3.2": "Non imponibili – cessioni intracomunitarie",
  "N3.3": "Non imponibili – cessioni verso San Marino",
  "N3.4": "Non imponibili – operazioni assimilate alle cessioni all'esportazione",
  "N3.5": "Non imponibili – a seguito di dichiarazioni d'intento",
  "N3.6": "Non imponibili – altre operazioni che non concorrono alla formazione del plafond",
  N4: "Esenti",
  N5: "Regime del margine / IVA non esposta in fattura",
};

export interface DraftLine {
  description: string | null;
  quantity: number;
  unitPrice: number;
  discountPercent?: number | null;
  taxPercent: number;
  nature?: string | null;
}

export type DraftProblem =
  | { kind: "no_lines" }
  | { kind: "line_without_description"; line: number }
  | { kind: "line_quantity"; line: number }
  | { kind: "zero_rate_without_nature"; line: number }
  | { kind: "nature_with_vat"; line: number }
  | { kind: "unknown_nature"; line: number }
  | { kind: "not_positive" };

/** What stops this draft being issued, line by line (1-based). Empty means it can go. */
export function draftProblems(lines: readonly DraftLine[], discountPercent = 0): DraftProblem[] {
  if (lines.length === 0) return [{ kind: "no_lines" }];
  const problems: DraftProblem[] = [];
  lines.forEach((l, i) => {
    const line = i + 1;
    if (!l.description?.trim()) problems.push({ kind: "line_without_description", line });
    if (!(l.quantity > 0)) problems.push({ kind: "line_quantity", line });
    const nature = l.nature?.trim() || null;
    if (l.taxPercent === 0 && !nature) problems.push({ kind: "zero_rate_without_nature", line });
    if (l.taxPercent > 0 && nature) problems.push({ kind: "nature_with_vat", line });
    if (nature && !Object.hasOwn(NATURE_CODES, nature)) problems.push({ kind: "unknown_nature", line });
  });
  const totals = computeDocument({ lines: [...lines], discountPercent });
  // A credit note is its own document type; an invoice of zero or less is not one.
  if (!(totals.total > 0)) problems.push({ kind: "not_positive" });
  return problems;
}

/** The stamp duty on an invoice, in euro. */
export const STAMP_DUTY = 2;
/** Above this, VAT-free amounts attract stamp duty. */
export const STAMP_DUTY_THRESHOLD = 77.47;

/**
 * Whether stamp duty is due, as a *suggestion* for the draft.
 *
 * ⚠️ Deliberately a proposal the person confirms, not a rule applied silently:
 * exports and intra-EU supplies (N3.1, N3.2) are outside it while other
 * non-taxable operations are not, and edge cases belong to an accountant. What
 * the code can do is not forget to ask when zero-rate amounts cross the threshold.
 */
export function suggestsStampDuty(lines: readonly DraftLine[], discountPercent = 0): boolean {
  const totals = computeDocument({ lines: [...lines], discountPercent });
  const exemptFromDuty = new Set(["N3.1", "N3.2"]);
  const vatFree = totals.lines.reduce((sum, l, i) => {
    const nature = lines[i].nature ?? "";
    return l.taxPercent === 0 && !exemptFromDuty.has(nature) ? sum + l.netAfterDocumentDiscount : sum;
  }, 0);
  return round2(vatFree) > STAMP_DUTY_THRESHOLD;
}

/** The sequence an invoice number is drawn from: one per document series and year. */
export function invoiceScope(series: string, year: number): string {
  return `invoice:${series.trim().toUpperCase()}:${year}`;
}

/** "12" for the main series, "12/B" for series B — what is printed and sent to SDI. */
export function formatInvoiceNumber(number: number, series: string): string {
  const s = series.trim().toUpperCase();
  return s ? `${number}/${s}` : String(number);
}

/** A series is empty (the main one) or a short code of letters and digits. */
export function isValidSeries(series: string): boolean {
  return /^[A-Z0-9]{0,10}$/.test(series.trim().toUpperCase());
}
