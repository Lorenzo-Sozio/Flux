"use client";

import { useEffect, useState } from "react";

import type { RawDep, RawTask } from "@/stores/gantt-store";
import { useGanttStore } from "@/stores/gantt-store";

import { GanttToolbar } from "./gantt-toolbar";
import { GanttView } from "./gantt-view";
import { useWorkloadConflictCount, WorkloadPanel } from "./workload-panel";

interface Props {
  tasks: RawTask[];
  dependencies: RawDep[];
  users: { id: string; name: string | null }[];
}

export function TaskGantt({ tasks, dependencies, users }: Props) {
  const initStore = useGanttStore((s) => s.initStore);

  const [viewMode, setViewMode] = useState<"Day" | "Week" | "Month">("Week");
  const [viewDate, setViewDate] = useState<Date>(new Date());
  const [showWorkload, setShowWorkload] = useState(false);

  // ganttKey forces GanttView to remount (and re-snapshot store data) whenever
  // the server provides a fresh dataset (revalidatePath after a mutation).
  // The store is populated synchronously before the first render via the
  // useState initializer below.
  const [ganttKey, setGanttKey] = useState(() => {
    useGanttStore.getState().initStore(tasks, dependencies);
    return 0;
  });

  // Subsequent prop changes = server revalidation → re-init store + remount Gantt
  useEffect(() => {
    initStore(tasks, dependencies);
    setGanttKey((k) => k + 1);
  }, [tasks, dependencies, initStore]);

  const conflictCount = useWorkloadConflictCount(viewDate);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <GanttToolbar
        viewMode={viewMode}
        setViewMode={setViewMode}
        viewDate={viewDate}
        setViewDate={setViewDate}
        showWorkload={showWorkload}
        onToggleWorkload={() => setShowWorkload((v) => !v)}
        conflictCount={conflictCount}
      />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <GanttView key={ganttKey} viewMode={viewMode} viewDate={viewDate} users={users} />
        {showWorkload && <WorkloadPanel viewDate={viewDate} onClose={() => setShowWorkload(false)} />}
      </div>
    </div>
  );
}
