"use client";

import { useCurrency } from "@/hooks/use-currency";

export function DealAmount({ amount, probability }: { amount: string | null; probability: number | null }) {
  const { formatAmount } = useCurrency();

  if (!amount) return <span>—</span>;

  return (
    <>
      {formatAmount(Number(amount))}
      {probability != null && (
        <span className="ml-1.5 text-xs font-normal text-muted-foreground">({probability}%)</span>
      )}
    </>
  );
}
