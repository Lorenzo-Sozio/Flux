"use client";

import { useCurrency } from "@/hooks/use-currency";

/**
 * A deal figure in the viewer's display currency.
 *
 * ⚠️ `formatAmount` is right here and would be wrong on a quote. `createDeal`
 * and `updateDeal` convert the amount typed into euros before storing it, so a
 * deal's `amount` is always EUR at rest — `deal.currency` only records what was
 * typed — which is exactly what `formatAmount` assumes. A document stores its
 * own currency's figures and must use `formatMoney` instead (see CLAUDE.md).
 */
export function DealAmount({ value }: { value: number | null }) {
  const { formatAmount } = useCurrency();
  if (value == null) return <span>—</span>;
  return <>{formatAmount(value)}</>;
}
