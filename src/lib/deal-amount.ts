import { convertToEur, type ExchangeRates } from "@/lib/currency-convert";

/**
 * A deal's value, three ways: as stored, as edited, as shown.
 *
 * ⚠️⚠️ **`amount` is EUR at rest, and nothing converts it twice.** Every total, the forecast
 * and every report add the column up, so it stays EUR. What broke was the round trip: the
 * edit form showed the EUR figure beside the deal's *own* currency, and saving converted
 * that figure again — a USD deal lost about 8% on every edit, and the board printed the
 * EUR number with a dollar sign. `amountOriginal` is the figure as typed; it is what the
 * form edits and what the board shows, and `amount` is always derived from it.
 */

export interface StoredDealAmount {
  /** EUR, as a numeric string. */
  amount: string;
  /** The figure as typed, or null when nothing was typed. */
  amountOriginal: string | null;
  currency: string;
}

/** What to write for a figure typed in `currency`, converted at today's `rates`. */
export function dealAmountForStorage(
  typed: string | number | null | undefined,
  currency: string | null | undefined,
  rates: ExchangeRates,
): StoredDealAmount {
  const code = (currency || "EUR").toUpperCase();
  const value = typed === null || typed === undefined || typed === "" ? null : Number(typed);
  if (value === null || !Number.isFinite(value)) return { amount: "0", amountOriginal: null, currency: code };
  const eur = code === "EUR" ? value : convertToEur(value, code, rates);
  return { amount: String(round2(eur)), amountOriginal: String(round2(value)), currency: code };
}

interface DealAmountFields {
  amount: string | number | null;
  amountOriginal?: string | number | null;
  currency: string | null;
}

/**
 * The figure and currency the edit form starts from.
 *
 * ⚠️ A deal written before `amountOriginal` existed, in a currency other than EUR, is
 * offered in EUR: its EUR value is the only figure known to be right. Reconstructing the
 * original with today's rate would put a number in the form nobody ever typed.
 */
export function dealAmountForEditing(deal: DealAmountFields): { amount: string; currency: string } {
  const currency = (deal.currency || "EUR").toUpperCase();
  if (deal.amountOriginal !== null && deal.amountOriginal !== undefined) {
    return { amount: String(deal.amountOriginal), currency };
  }
  return { amount: deal.amount === null ? "" : String(deal.amount), currency: "EUR" };
}

/** The figure and currency a deal is shown with: what was typed, or EUR when unknown. */
export function dealAmountForDisplay(deal: DealAmountFields): { value: number; currency: string } {
  if (deal.amountOriginal !== null && deal.amountOriginal !== undefined) {
    return { value: Number(deal.amountOriginal), currency: (deal.currency || "EUR").toUpperCase() };
  }
  return { value: Number(deal.amount ?? 0), currency: "EUR" };
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
