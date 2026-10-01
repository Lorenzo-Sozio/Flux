import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { loadRecordTimeline, type TimelineScope } from "@/lib/record-timeline";
import { getDb } from "@/lib/tenant-context";

import { RecordTimelineList } from "./record-timeline-list";

/**
 * A record's timeline: its own activities and its related records', field changes and
 * quote events, newest first (src/lib/record-timeline.ts). Loads its first page itself,
 * so a page places it with one line.
 */
export function RecordTimeline(props: { scope: TimelineScope; revalidatePathStr: string; canWrite: boolean }) {
  // ⚠️ Its own boundary: the page around it is drawn and sent while its history still loads,
  // instead of waiting for the slowest card of the page.
  return (
    <Suspense fallback={<TimelineSkeleton />}>
      <TimelineFirstPage {...props} />
    </Suspense>
  );
}

function TimelineSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
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
  );
}

async function TimelineFirstPage({
  scope,
  revalidatePathStr,
  canWrite,
}: {
  scope: TimelineScope;
  revalidatePathStr: string;
  canWrite: boolean;
}) {
  const first = await loadRecordTimeline(await getDb(), scope);
  return (
    <RecordTimelineList
      // A fresh list whenever the server sends a new first page (after a save, a refresh).
      key={first.items[0]?.key ?? "empty"}
      scope={scope}
      initial={first}
      revalidatePathStr={revalidatePathStr}
      canWrite={canWrite}
    />
  );
}
