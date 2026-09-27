"use client";

import { useCurrency } from "@/hooks/use-currency";

/**
 * The value of a contact's open deals, in the viewer's display currency.
 *
 * ⚠️ `formatAmount`, not `formatMoney`: `createDeal` and `updateDeal` store a
 * deal's amount in euros whatever was typed (`deal.currency` only records the
 * typing), so a sum of deal amounts is a sum of euros and converts like one. A
 * total of quotes or orders would be a different thing — those keep their own
 * currency and are never summed across it (see CLAUDE.md).
 */
export function OpenDealsValue({ value }: { value: number }) {
  const { formatAmount } = useCurrency();
  return <>{formatAmount(value)}</>;
}
