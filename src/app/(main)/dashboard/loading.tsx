/**
 * The dashboard's loading skeleton.
 *
 * Every page is a server component that awaits all of its queries before
 * producing a pixel, and there was no `loading.tsx` anywhere in the app. Clicking
 * a sidebar item left the previous page on screen, motionless, for as long as the
 * queries took — which reads as a frozen application rather than a slow one
 * (audit rilievo B-07).
 *
 * Deliberately generic: a header, a row of summary tiles and a table. That is the
 * shape of nearly every screen here, so the transition lands roughly where the
 * content will, instead of jumping.
 */
import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>

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
    </div>
  );
}
