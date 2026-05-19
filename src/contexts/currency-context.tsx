"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { useLocale } from "next-intl";

import {
  CURRENCY_LOCALE,
  CURRENCY_MANUAL_OVERRIDE_KEY,
  CURRENCY_PREFERENCE_KEY,
  LOCALE_TO_CURRENCY,
} from "@/lib/currency-config";
import type { ExchangeRates } from "@/lib/exchange-rates";
import { formatCurrency } from "@/lib/utils";

// Re-export the type from currency-config so consumers can import from here
export type { ExchangeRates };

// ─── Context shape ────────────────────────────────────────────────────────────

interface CurrencyContextValue {
  /** Currently active display currency code (ISO 4217) */
  currency: string;
  /** Exchange rates keyed by lowercase ISO 4217 code, relative to EUR base */
  rates: ExchangeRates | null;
  /** True while rates are being fetched for the first time */
  loading: boolean;
  /** Non-null if the rates API call failed */
  error: string | null;
  /** ISO 8601 string of when the cached rates were last fetched */
  fetchedAt: string | null;
  /** Programmatically change the display currency (persisted to localStorage) */
  setCurrency: (code: string) => void;
  /**
   * Format a EUR-stored amount for display in the current currency.
   * Accepts optional overrides for noDecimals, minimumFractionDigits, etc.
   */
  formatAmount: (
    eurAmount: number,
    opts?: { noDecimals?: boolean; minimumFractionDigits?: number; maximumFractionDigits?: number },
  ) => string;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const CurrencyContext = createContext<CurrencyContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const locale = useLocale();

  // Determine initial currency from localStorage or locale default
  const getInitialCurrency = (): string => {
    if (typeof window === "undefined") return LOCALE_TO_CURRENCY[locale] ?? "EUR";
    const stored = localStorage.getItem(CURRENCY_PREFERENCE_KEY);
    if (stored) return stored;
    return LOCALE_TO_CURRENCY[locale] ?? "EUR";
  };

  const [currency, setCurrencyState] = useState<string>(getInitialCurrency);
  const [rates, setRates] = useState<ExchangeRates | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);

  // When locale changes, auto-switch currency only if no manual override
  useEffect(() => {
    const hasManualOverride = localStorage.getItem(CURRENCY_MANUAL_OVERRIDE_KEY) === "1";
    if (!hasManualOverride) {
      const localeCurrency = LOCALE_TO_CURRENCY[locale];
      if (localeCurrency) {
        setCurrencyState(localeCurrency);
        localStorage.setItem(CURRENCY_PREFERENCE_KEY, localeCurrency);
      }
    }
  }, [locale]);

  // Fetch rates on mount
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/currency/rates");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setRates(data.rates as ExchangeRates);
          setFetchedAt(data.fetchedAt as string);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load exchange rates");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const setCurrency = useCallback((code: string) => {
    setCurrencyState(code);
    localStorage.setItem(CURRENCY_PREFERENCE_KEY, code);
    localStorage.setItem(CURRENCY_MANUAL_OVERRIDE_KEY, "1");
  }, []);

  const formatAmount = useCallback(
    (
      eurAmount: number,
      opts?: { noDecimals?: boolean; minimumFractionDigits?: number; maximumFractionDigits?: number },
    ): string => {
      if (!rates) {
        // Rates not loaded yet — show EUR as fallback
        return formatCurrency(eurAmount, { currency: "EUR", locale: "it-IT", ...opts });
      }
      const rate = currency === "EUR" ? 1 : (rates[currency.toLowerCase()] ?? 1);
      const converted = eurAmount * rate;
      const displayLocale = CURRENCY_LOCALE[currency] ?? "en-US";
      return formatCurrency(converted, { currency, locale: displayLocale, ...opts });
    },
    [currency, rates],
  );

  const value = useMemo<CurrencyContextValue>(
    () => ({ currency, rates, loading, error, fetchedAt, setCurrency, formatAmount }),
    [currency, rates, loading, error, fetchedAt, setCurrency, formatAmount],
  );

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useCurrencyContext(): CurrencyContextValue {
  const ctx = useContext(CurrencyContext);
  if (!ctx) {
    throw new Error("useCurrencyContext must be used inside <CurrencyProvider>");
  }
  return ctx;
}
