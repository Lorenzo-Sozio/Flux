"use client";

import { useTranslations } from "next-intl";

import { adjustmentLabel } from "@/lib/price-list";
import { cn } from "@/lib/utils";

/**
 * The list's percentage as a sentence: "10% di sconto", "5% di maggiorazione",
 * or "Prezzo di catalogo" when it moves nothing.
 *
 * ⚠️ `adjustmentLabel` returns the direction and the figure as data rather than a
 * formed phrase, precisely so this can be said in the reader's language. Writing
 * the sign into a string here — "-10%" — would read as a discount in one language
 * and as arithmetic in every other, and a positive list would look like a typo.
 */
export function AdjustmentText({
  adjustmentPercent,
  className,
}: {
  adjustmentPercent: string | number | null | undefined;
  className?: string;
}) {
  const t = useTranslations("priceLists.adjustment");
  const { direction, percent } = adjustmentLabel(adjustmentPercent);

  return (
    <span
      className={cn(
        "text-sm",
        direction === "off" && "text-emerald-600 dark:text-emerald-400",
        direction === "on" && "text-amber-600 dark:text-amber-400",
        direction === "none" && "text-muted-foreground",
        className,
      )}
    >
      {direction === "none" ? t("none") : t(direction, { percent })}
    </span>
  );
}
