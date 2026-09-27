"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePeriodLabel } from "@/hooks/use-period-label";
import { type PeriodKind, parsePeriodKey, periodOfKind, shiftPeriod } from "@/lib/calendar-period";

const KINDS: PeriodKind[] = ["month", "quarter", "year"];

/**
 * Month, quarter or year, and the arrows between them — for any report that reads a calendar
 * period from `?period=` (src/lib/calendar-period.ts). One control, so every report walks
 * through time the same way.
 */
export function PeriodNav({
  period,
  today,
  href,
}: {
  period: string;
  /** This month on the workspace's clock: where "today" goes. */
  today: string;
  href: (period: string) => string;
}) {
  const t = useTranslations("periods");
  const router = useRouter();
  const label = usePeriodLabel();
  const kind = parsePeriodKey(period)?.kind ?? "month";
  const current = periodOfKind(today, kind);
  const prev = shiftPeriod(period, -1);
  const next = shiftPeriod(period, 1);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={kind}
        onValueChange={(k) => {
          const to = periodOfKind(period, k as PeriodKind);
          if (to) router.replace(href(to), { scroll: false });
        }}
      >
        <SelectTrigger className="h-8 w-36 text-sm" aria-label={t("kind")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {KINDS.map((k) => (
            <SelectItem key={k} value={k}>
              {t(`kinds.${k}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex items-center gap-1">
        <Button asChild variant="outline" size="icon" className="h-8 w-8">
          <Link href={prev ? href(prev) : "#"} aria-label={t("previous")} scroll={false}>
            <ChevronLeft className="h-4 w-4" />
          </Link>
        </Button>
        <span className="min-w-36 px-2 text-center font-medium text-sm capitalize">{label(period)}</span>
        <Button asChild variant="outline" size="icon" className="h-8 w-8">
          <Link href={next ? href(next) : "#"} aria-label={t("next")} scroll={false}>
            <ChevronRight className="h-4 w-4" />
          </Link>
        </Button>
      </div>
      {current && current !== period && (
        <Button asChild variant="ghost" size="sm" className="h-8">
          <Link href={href(current)} scroll={false}>
            {t("current")}
          </Link>
        </Button>
      )}
    </div>
  );
}
