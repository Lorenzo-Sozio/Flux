"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SUPPORTED_CURRENCIES } from "@/lib/currency-config";

/**
 * The currency a document is written in. A list, not a text box: "EURO", "€" and
 * "eur" typed into a free field are three currencies Intl cannot format.
 */
export function CurrencySelect({
  value,
  onChange,
  disabled,
  className,
  id,
}: {
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
  className?: string;
  id?: string;
}) {
  const known = SUPPORTED_CURRENCIES.some((c) => c.code === value);
  return (
    <Select value={value || "EUR"} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} className={className ?? "h-9 w-full"}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {/* A code stored before this list existed stays selectable rather than vanishing. */}
        {!known && value && <SelectItem value={value}>{value}</SelectItem>}
        {SUPPORTED_CURRENCIES.map((c) => (
          <SelectItem key={c.code} value={c.code}>
            {c.code} · {c.symbol}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
