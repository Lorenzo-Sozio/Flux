"use client";

import { useCurrency } from "@/hooks/use-currency";

/**
 * An amount stored in EUR, shown in the currency and locale the viewer chose.
 *
 * For server components: the currency lives in a client context, so a server
 * page that formats money itself gets it wrong in one of the two.
 */
export function Money({ value, decimals = false }: { value: number; decimals?: boolean }) {
  const { formatAmount } = useCurrency();
  return <>{formatAmount(value, { noDecimals: !decimals })}</>;
}
