import { eq } from "drizzle-orm";

import { exchangeRatesCache } from "@/db/schema";
import { RATES_CACHE_DURATION_HOURS } from "@/lib/currency-config";
import type { ExchangeRates } from "@/lib/currency-convert";
import { getDb } from "@/lib/tenant-context";

// Re-export pure helpers so callers can keep using @/lib/exchange-rates as the single import
export type { ExchangeRates } from "@/lib/currency-convert";
export { convertFromEur, convertToEur } from "@/lib/currency-convert";

const PRIMARY_URL = "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/eur.json";
const FALLBACK_URL = "https://currency-api.pages.dev/v1/currencies/eur.json";

interface CachedRates {
  rates: ExchangeRates;
  fetchedAt: Date;
}

async function fetchRatesFromApi(): Promise<ExchangeRates> {
  const tryFetch = async (url: string): Promise<ExchangeRates | null> => {
    try {
      const res = await fetch(url, { next: { revalidate: 0 } });
      if (!res.ok) return null;
      const json = await res.json();
      const rates = json?.eur as Record<string, number> | undefined;
      if (!rates || typeof rates !== "object") return null;
      return rates;
    } catch {
      return null;
    }
  };

  const primary = await tryFetch(PRIMARY_URL);
  if (primary) return primary;

  const fallback = await tryFetch(FALLBACK_URL);
  if (fallback) return fallback;

  throw new Error("Exchange rate API unavailable — both endpoints failed");
}

export async function getExchangeRates(): Promise<CachedRates> {
  const db = await getDb();

  const [cached] = await db.select().from(exchangeRatesCache).where(eq(exchangeRatesCache.id, "eur"));

  const cacheMaxAgeMs = RATES_CACHE_DURATION_HOURS * 60 * 60 * 1000;
  const isStale = !cached || Date.now() - cached.fetchedAt.getTime() > cacheMaxAgeMs;

  if (!isStale && cached) {
    return { rates: JSON.parse(cached.rates) as ExchangeRates, fetchedAt: cached.fetchedAt };
  }

  let freshRates: ExchangeRates;
  try {
    freshRates = await fetchRatesFromApi();
  } catch {
    if (cached) {
      return { rates: JSON.parse(cached.rates) as ExchangeRates, fetchedAt: cached.fetchedAt };
    }
    throw new Error("Exchange rates unavailable — no cache and API unreachable");
  }

  const now = new Date();
  const ratesJson = JSON.stringify(freshRates);

  await db
    .insert(exchangeRatesCache)
    .values({ id: "eur", rates: ratesJson, fetchedAt: now })
    .onConflictDoUpdate({
      target: exchangeRatesCache.id,
      set: { rates: ratesJson, fetchedAt: now },
    });

  return { rates: freshRates, fetchedAt: now };
}
