"use client";

import { useCallback } from "react";

import { useLocale, useTranslations } from "next-intl";

import { parsePeriodKey } from "@/lib/calendar-period";

/** "settembre 2026", "3° trimestre 2026", "2026" — a calendar period key as a person reads it. */
export function usePeriodLabel(): (key: string) => string {
  const locale = useLocale();
  const t = useTranslations("periods");
  return useCallback(
    (key: string) => {
      const p = parsePeriodKey(key);
      if (!p) return key;
      if (p.kind === "month") {
        return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(
          new Date(Date.UTC(p.year, p.index - 1, 1)),
        );
      }
      if (p.kind === "quarter") return t("quarter", { quarter: p.index, year: p.year });
      return String(p.year);
    },
    [locale, t],
  );
}
