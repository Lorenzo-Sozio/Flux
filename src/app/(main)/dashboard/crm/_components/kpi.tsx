import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * ⚠️ Two across on a phone leaves ~120px of content per card, and "€1.234.567"
 * in `text-2xl` is wider than that: it went past the card's edge rather than
 * wrapping, because a number has nowhere to break. Smaller below `sm`, and
 * `break-words` for the MRR card, which joins one figure per currency.
 */
export const KPI_VALUE = "break-words font-bold text-xl tabular-nums sm:text-2xl";

/** A figure on a home dashboard, and the list it counts one click away. */
export function Kpi({
  href,
  accent,
  title,
  icon,
  children,
}: {
  href: string;
  accent: string;
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className="group min-w-0">
      {/* h-full: two cards side by side on a phone with different heights read as a mistake. */}
      <Card
        className={`h-full cursor-pointer gap-3 border-l-4 py-4 shadow-sm transition-shadow group-hover:shadow-md sm:gap-6 sm:py-6 ${accent}`}
      >
        <CardHeader className="flex flex-row items-center justify-between gap-2 px-4 pb-2 sm:px-6">
          <CardTitle className="min-w-0 font-medium text-muted-foreground text-sm">{title}</CardTitle>
          {icon}
        </CardHeader>
        <CardContent className="px-4 sm:px-6">{children}</CardContent>
      </Card>
    </Link>
  );
}

/**
 * A lead figure: one of the few a dashboard opens with, drawn larger and on a tinted
 * card so the eye lands there first. Same contract as `Kpi` — it links to what it counts.
 */
export function HeadlineKpi({
  href,
  title,
  icon,
  value,
  children,
}: {
  href: string;
  title: string;
  icon: React.ReactNode;
  value: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <Link href={href} className="group min-w-0">
      <Card className="h-full cursor-pointer gap-2 border-primary/20 bg-primary/5 py-4 shadow-sm transition-shadow group-hover:shadow-md sm:gap-3 sm:py-5">
        <CardHeader className="flex flex-row items-center justify-between gap-2 px-4 sm:px-6">
          <CardTitle className="min-w-0 font-medium text-sm">{title}</CardTitle>
          {icon}
        </CardHeader>
        <CardContent className="px-4 sm:px-6">
          <div className="break-words font-bold text-2xl text-foreground tabular-nums tracking-tight sm:text-3xl">
            {value}
          </div>
          {children && <div className="mt-1 text-muted-foreground text-xs">{children}</div>}
        </CardContent>
      </Card>
    </Link>
  );
}
