/**
 * What a page looks like while it loads, by kind of page — a list, a record, the board, the
 * calendar — so the skeleton a `loading.tsx` shows lands where the content will.
 *
 * ⚠️ One `loading.tsx` for the whole dashboard was a boundary for its direct children only: moving
 * from a list to a record, or between the pages of a section, kept that boundary on screen — or
 * nothing, and the old page stayed frozen until the server answered. Each section and each record
 * page has its own now, drawn from these. And a link prefetches down to the nearest boundary, so
 * the skeleton is on screen at the tap (src/components/intent-link.tsx).
 */
import { useTranslations } from "next-intl";

import { Skeleton } from "@/components/ui/skeleton";

function Busy({ children }: { children: React.ReactNode }) {
  const t = useTranslations("common");
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">{t("loading")}</span>
      {children}
    </div>
  );
}

/** A header, a row of summary tiles and a table: the shape of most screens here. */
export function ListPageSkeleton() {
  return (
    <Busy>
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-full max-w-72" />
        </div>
        <Skeleton className="h-9 w-32" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="space-y-3 rounded-lg border p-4">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-3 w-28" />
          </div>
        ))}
      </div>

      <div className="rounded-lg border">
        <div className="border-b p-4">
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="divide-y">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center gap-4 p-4">
              <Skeleton className="size-8 shrink-0 rounded-full" />
              <Skeleton className="h-4 max-w-[240px] flex-1" />
              <Skeleton className="hidden h-4 w-32 sm:block" />
              <Skeleton className="hidden h-4 w-24 md:block" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      </div>
    </Busy>
  );
}

/** A record's page (src/components/crm/record/): hero, figures, the work beside the reference. */
export function RecordPageSkeleton() {
  return (
    <Busy>
      <Skeleton className="h-4 w-28" />
      <div className="space-y-4 rounded-xl border p-4 sm:p-6">
        <div className="flex gap-2">
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
        <Skeleton className="h-8 w-2/3 max-w-md" />
        <Skeleton className="h-4 w-1/2 max-w-sm" />
        <div className="flex gap-2">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-24" />
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="space-y-2 rounded-lg bg-muted/40 p-3">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-6 w-24" />
            </div>
          ))}
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-4 rounded-xl border p-4">
          <Skeleton className="h-5 w-32" />
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="size-8 shrink-0 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            </div>
          ))}
        </div>
        <div className="hidden space-y-3 rounded-xl border p-4 lg:block">
          <Skeleton className="h-5 w-28" />
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="grid grid-cols-[7.5rem_1fr] gap-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3 w-full" />
            </div>
          ))}
        </div>
      </div>
    </Busy>
  );
}

/** The pipeline board: columns of cards. */
export function BoardSkeleton() {
  return (
    <Busy>
      <div className="flex gap-4 overflow-hidden">
        {[0, 1, 2, 3].map((col) => (
          <div key={col} className="w-72 shrink-0 space-y-3 rounded-xl bg-muted/40 p-3">
            <Skeleton className="h-5 w-32" />
            {[0, 1, 2].map((card) => (
              <div key={card} className="space-y-2 rounded-lg border bg-background p-3">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </Busy>
  );
}

/** The calendar: a toolbar and a grid. */
export function CalendarSkeleton() {
  return (
    <Busy>
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-8 w-40" />
        <div className="flex gap-2">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-32" />
        </div>
      </div>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border bg-border">
        {Array.from({ length: 35 }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed grid of placeholders
          <div key={i} className="min-h-16 space-y-1.5 bg-background p-2 sm:min-h-24">
            <Skeleton className="h-3 w-5" />
            {i % 3 === 0 && <Skeleton className="h-3 w-full" />}
          </div>
        ))}
      </div>
    </Busy>
  );
}
