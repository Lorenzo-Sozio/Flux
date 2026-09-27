import { loadRecordTimeline, type TimelineScope } from "@/lib/record-timeline";
import { getDb } from "@/lib/tenant-context";

import { RecordTimelineList } from "./record-timeline-list";

/**
 * A record's timeline: its own activities and its related records', field changes and
 * quote events, newest first (src/lib/record-timeline.ts). Loads its first page itself,
 * so a page places it with one line.
 */
export async function RecordTimeline({
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
