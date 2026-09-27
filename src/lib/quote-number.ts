import crypto from "node:crypto";

/**
 * A quote's number: `QT-<yyyymm>-<8 hex>`. One definition for the quote form and the API's
 * draft (src/lib/quote-draft.ts), so the two never number quotes two ways.
 */
export function generateQuoteNumber(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const random = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `QT-${year}${month}-${random}`;
}
