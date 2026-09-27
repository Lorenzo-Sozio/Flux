"use client";

import Link from "next/link";

import { Clock, List } from "lucide-react";

import { DAY_LAYOUT_COOKIE, type DayLayout } from "@/lib/calendar-day-layout";
import { cn } from "@/lib/utils";

/**
 * "List | Grid" for the day view. The link carries the choice, so the server draws it;
 * the click also remembers it for this browser (src/lib/calendar-day-layout.ts).
 *
 * `shown` is what is on screen when nobody has chosen: the list below md, the grid above,
 * so the highlighted half is right at every width without a script deciding it.
 */
export function DayLayoutToggle({
  layout,
  hrefs,
  labels,
  label,
  className,
}: {
  layout: DayLayout | null;
  hrefs: Record<DayLayout, string>;
  labels: Record<DayLayout, string>;
  label: string;
  className?: string;
}) {
  const remember = (v: DayLayout) => {
    // biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API is missing from older Safari, and the server must read this.
    document.cookie = `${DAY_LAYOUT_COOKIE}=${v}; path=/dashboard; max-age=31536000; samesite=lax`;
  };
  const on = "bg-background text-foreground shadow-sm";
  const off = "text-muted-foreground";
  const state = (v: DayLayout) =>
    layout === v
      ? on
      : layout
        ? off
        : // Nobody chose: the list is on screen below md, the grid from md up.
          v === "list"
          ? `${on} md:bg-transparent md:text-muted-foreground md:shadow-none`
          : `${off} md:bg-background md:text-foreground md:shadow-sm`;

  return (
    <nav aria-label={label} className={cn("flex shrink-0 rounded-lg border bg-muted/40 p-0.5", className)}>
      {(["list", "grid"] as const).map((v) => {
        const Icon = v === "list" ? List : Clock;
        return (
          <Link
            key={v}
            href={hrefs[v]}
            scroll={false}
            onClick={() => remember(v)}
            aria-current={layout === v ? "true" : undefined}
            className={cn(
              "flex min-h-8 items-center gap-1.5 rounded-md px-2.5 py-1 font-medium text-xs transition-all",
              state(v),
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {/* Icons alone on a phone: beside the week strip's headline, the words cut the date short. */}
            <span className="max-sm:sr-only">{labels[v]}</span>
          </Link>
        );
      })}
    </nav>
  );
}
