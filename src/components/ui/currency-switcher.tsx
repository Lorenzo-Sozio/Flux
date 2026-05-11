"use client";

import { useTransition } from "react";
import { Check, BadgeDollarSign } from "lucide-react";
import { useTranslations } from "next-intl";

import { useCurrency } from "@/hooks/use-currency";
import { SUPPORTED_CURRENCIES } from "@/lib/currency-config";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export function CurrencySwitcher() {
  const { currency, setCurrency, rates, loading } = useCurrency();
  const [isPending, startTransition] = useTransition();
  const t = useTranslations("currency");

  const handleChange = (code: string) => {
    startTransition(() => {
      setCurrency(code);
    });
  };

  const currentMeta = SUPPORTED_CURRENCIES.find((c) => c.code === currency);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn("h-8 gap-1 px-2 font-mono text-xs tabular-nums", isPending && "opacity-50")}
          disabled={isPending || loading}
          title={t("switchCurrency")}
        >
          <BadgeDollarSign className="h-3.5 w-3.5" />
          <span>{currentMeta?.symbol ?? currency}</span>
          <span className="text-muted-foreground">{currency}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="text-xs text-muted-foreground">{t("displayCurrency")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup className="max-h-72 overflow-y-auto">
          {SUPPORTED_CURRENCIES.map((meta) => {
            const rate = rates?.[meta.code.toLowerCase()];
            return (
              <DropdownMenuItem
                key={meta.code}
                onClick={() => handleChange(meta.code)}
                className="cursor-pointer gap-2"
              >
                <span className="w-6 text-center font-medium">{meta.symbol}</span>
                <span className="flex-1">{meta.code}</span>
                {rate && meta.code !== "EUR" && (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {rate.toFixed(4)}
                  </span>
                )}
                {currency === meta.code && <Check className="h-3.5 w-3.5 text-primary" />}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
