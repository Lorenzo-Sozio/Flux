import { BASE_CURRENCY } from "@/lib/currency-config";

export type ExchangeRates = Record<string, number>;

export function convertFromEur(amountEur: number, toCurrency: string, rates: ExchangeRates): number {
  if (toCurrency.toUpperCase() === BASE_CURRENCY) return amountEur;
  const rate = rates[toCurrency.toLowerCase()];
  if (!rate) return amountEur;
  return amountEur * rate;
}

export function convertToEur(amount: number, fromCurrency: string, rates: ExchangeRates): number {
  if (fromCurrency.toUpperCase() === BASE_CURRENCY) return amount;
  const rate = rates[fromCurrency.toLowerCase()];
  if (!rate) return amount;
  return amount / rate;
}
