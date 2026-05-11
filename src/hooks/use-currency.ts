"use client";

import { useCurrencyContext, type ExchangeRates } from "@/contexts/currency-context";

export type { ExchangeRates };

/**
 * Convenience hook for components that display monetary amounts stored in EUR.
 *
 * Usage:
 *   const { formatAmount, currency, setCurrency } = useCurrency();
 *   <span>{formatAmount(deal.amount)}</span>
 */
export function useCurrency() {
  return useCurrencyContext();
}
