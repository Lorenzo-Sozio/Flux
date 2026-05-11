import { NextRequest, NextResponse } from "next/server";
import { getExchangeRates, convertFromEur } from "@/lib/exchange-rates";

export const revalidate = 0;

/**
 * GET /api/currency/rates
 *
 * Returns current EUR-based exchange rates from the Fawaz API (DB-cached for 6h).
 *
 * Optional header:
 *   X-Currency: USD
 *   → converts a test amount or just validates the currency code exists in the rates
 *
 * Response body:
 *   { rates, baseCurrency, fetchedAt }
 */
export async function GET(req: NextRequest) {
  try {
    const { rates, fetchedAt } = await getExchangeRates();

    const requestedCurrency = req.headers.get("X-Currency")?.toUpperCase();

    // Validate the requested currency if provided
    if (requestedCurrency && requestedCurrency !== "EUR") {
      const rate = rates[requestedCurrency.toLowerCase()];
      if (!rate) {
        return NextResponse.json(
          { error: `Currency ${requestedCurrency} not found in rates` },
          { status: 400 },
        );
      }
    }

    return NextResponse.json(
      {
        rates,
        baseCurrency: "EUR",
        fetchedAt: fetchedAt.toISOString(),
        requestedCurrency: requestedCurrency ?? "EUR",
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=3600",
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch exchange rates" },
      { status: 503 },
    );
  }
}

/**
 * POST /api/currency/rates/convert
 * Body: { amount: number, from: string, to: string }
 * Returns the converted amount using current rates.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { amount, from, to } = body as { amount: number; from: string; to: string };

    if (typeof amount !== "number" || !from || !to) {
      return NextResponse.json({ error: "amount, from, and to are required" }, { status: 400 });
    }

    const { rates } = await getExchangeRates();

    // Convert from → EUR → to
    let eurAmount = amount;
    if (from.toUpperCase() !== "EUR") {
      const fromRate = rates[from.toLowerCase()];
      if (!fromRate) return NextResponse.json({ error: `Unknown currency: ${from}` }, { status: 400 });
      eurAmount = amount / fromRate;
    }

    const converted = convertFromEur(eurAmount, to.toUpperCase(), rates);

    return NextResponse.json({ amount: converted, from, to, rate: converted / amount });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Conversion failed" },
      { status: 503 },
    );
  }
}
