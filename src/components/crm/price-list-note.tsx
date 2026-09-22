"use client";

import { Tag } from "lucide-react";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { adjustmentLabel, type PriceRules } from "@/lib/price-list";

/**
 * price-list-note.tsx — what the reader is shown about where a price came from.
 *
 * A figure a salesperson cannot explain is one they cannot defend on the
 * telephone, so a price that is not the catalogue price says so: once in the
 * header of the lines, naming the list, and once beside the line itself.
 *
 * ⚠️ Discreet on purpose. This is not a warning — a customer on a list paying
 * the list's price is the system working — and a loud banner on every quote
 * written for a reseller is one the reader stops seeing within a week.
 */

/** "Listino: Rivenditori (−10%)", with the optional button that re-prices the lines. */
export function PriceListNote({
  rules,
  onApply,
  applyDisabled,
  className,
}: {
  rules: PriceRules | null;
  /** Given, the reader can ask for the list to be applied to the lines already written. */
  onApply?: () => void;
  applyDisabled?: boolean;
  className?: string;
}) {
  const t = useTranslations("documents.priceList");
  if (!rules) return null;

  const { direction, percent } = adjustmentLabel(rules.adjustmentPercent);
  const label =
    direction === "off"
      ? t("headerOff", { name: rules.name, percent })
      : direction === "on"
        ? t("headerOn", { name: rules.name, percent })
        : t("headerNone", { name: rules.name });

  return (
    // min-w-0 on the text: a long list name in a justify-between row grows the
    // row rather than eliding, and pushes the button past the edge of a phone.
    <div className={`flex min-w-0 flex-wrap items-center gap-2 ${className ?? ""}`}>
      <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
        <Tag className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{label}</span>
      </span>
      {onApply && (
        // The button says what it does; the title says why it has to be pressed
        // at all, which is the part a reader would otherwise have to discover by
        // noticing that nothing changed.
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={onApply}
          disabled={applyDisabled}
          title={t("manualPricesKept")}
        >
          {t("apply")}
        </Button>
      )}
    </div>
  );
}

/** The mark on a single line whose price the list decided. Nothing when it did not. */
export function PriceSourceBadge({
  source,
  listName,
  className,
}: {
  source: "percent" | "override" | null;
  listName?: string;
  className?: string;
}) {
  const t = useTranslations("documents.priceList");
  if (!source) return null;
  return (
    <Badge
      variant="outline"
      className={`h-5 border-primary/30 px-1.5 font-normal text-[10px] text-primary ${className ?? ""}`}
      title={listName ? t("badgeTitle", { name: listName }) : undefined}
    >
      {source === "override" ? t("fromOverride") : t("fromPercent")}
    </Badge>
  );
}
