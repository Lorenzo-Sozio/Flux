import { create } from "zustand";

import { scheduleSuccessors } from "@/lib/gantt-scheduler";

// ─── Raw DB types ─────────────────────────────────────────────────────────────

export type RawTask = {
  id: string;
  title: string;
  status: string | null;
  priority: string | null;
  startDate: Date | null;
  dueDate: Date | null;
  progressPct: number;
  parentId: string | null;
  depth: number;
  assigneeId: string | null;
  assigneeName: string | null;
  estimatedHours: number | null;
};

export type RawDep = {
  id: string;
  predecessorId: string;
  successorId: string;
  type: string;
  lagDays: number;
};

// ─── SVAR-compatible types ────────────────────────────────────────────────────

export type SvarTask = {
  id: string;
  text: string;
  start_date: Date;
  end_date: Date;
  /** Calendar days (used by SVAR for bar width rendering) */
  duration: number;
  /** 0..100 (SVAR convention) */
  progress: number;
  parent?: string;
  open?: boolean;
  // CRM extras — passed through for tooltips, coloring, workload
  status: string;
  priority: string;
  assigneeId: string | null;
  assigneeName: string | null;
  estimatedHours: number | null;
};

export type SvarLink = {
  id: string;
  source: string;
  target: string;
  /** SVAR string type: "e2s"=FS, "s2s"=SS, "e2e"=FF, "s2e"=SF */
  type: "e2s" | "s2s" | "e2e" | "s2e";
  lagDays: number;
  depType: "FS" | "SS" | "FF" | "SF";
};

// ─── Constants ────────────────────────────────────────────────────────────────

export const DEP_TYPE_MAP = {
  FS: "e2s",
  SS: "s2s",
  FF: "e2e",
  SF: "s2e",
} as const satisfies Record<"FS" | "SS" | "FF" | "SF", "e2s" | "s2s" | "e2e" | "s2e">;

// ─── Mapping helpers ──────────────────────────────────────────────────────────

function toSvarTask(raw: RawTask): SvarTask | null {
  if (!raw.dueDate) return null;

  const end_date = new Date(raw.dueDate);
  const start_date = raw.startDate ? new Date(raw.startDate) : new Date(end_date.getTime() - 86400000);
  if (start_date >= end_date) start_date.setTime(end_date.getTime() - 86400000);

  const duration = Math.max(1, Math.round((end_date.getTime() - start_date.getTime()) / 86400000));

  return {
    id: raw.id,
    text: raw.title,
    start_date,
    end_date,
    duration,
    progress: raw.status === "done" ? 100 : raw.progressPct,
    parent: raw.parentId ?? undefined,
    open: raw.depth === 0,
    status: raw.status ?? "todo",
    priority: raw.priority ?? "normal",
    assigneeId: raw.assigneeId,
    assigneeName: raw.assigneeName,
    estimatedHours: raw.estimatedHours,
  };
}

function toSvarLink(dep: RawDep): SvarLink {
  const knownType = dep.type as "FS" | "SS" | "FF" | "SF";
  const depType = knownType in DEP_TYPE_MAP ? knownType : "FS";
  return {
    id: dep.id,
    source: dep.predecessorId,
    target: dep.successorId,
    type: DEP_TYPE_MAP[depType],
    lagDays: dep.lagDays ?? 0,
    depType,
  };
}

// ─── Store ────────────────────────────────────────────────────────────────────

type GanttState = {
  tasks: SvarTask[];
  links: SvarLink[];
  rawTasks: RawTask[];

  /**
   * Populates the store from data fetched by the server component.
   * Call this once from a useEffect in the client wrapper, passing
   * the props received from page.tsx.
   */
  initStore: (rawTasks: RawTask[], rawDeps: RawDep[]) => void;

  /**
   * Applies an optimistic date update to a single task.
   * After Step 2 is implemented, this will also trigger the
   * auto-scheduler to propagate changes through FS/SS/FF/SF links.
   */
  applyTaskDateChange: (taskId: string, newStart: Date, newEnd: Date) => void;

  /**
   * Replaces a task's full data after the server has confirmed
   * the update (used to sync scheduler-propagated dates back into
   * the store without a full re-init).
   */
  patchTask: (taskId: string, patch: Partial<Pick<SvarTask, "start_date" | "end_date" | "duration">>) => void;

  addLink: (link: SvarLink) => void;
  removeLink: (linkId: string) => void;
  replaceLinkId: (tempId: string, realId: string) => void;
};

export const useGanttStore = create<GanttState>()((set, get) => ({
  tasks: [],
  links: [],
  rawTasks: [],

  initStore(rawTasks, rawDeps) {
    const mapped = rawTasks.flatMap((r) => {
      const t = toSvarTask(r);
      return t ? [t] : [];
    });

    const taskIds = new Set(mapped.map((t) => t.id));
    // IDs that appear as a parent of at least one other task
    const parentIds = new Set(
      mapped.map((t) => t.parent).filter((p): p is string => p !== undefined && taskIds.has(p)),
    );

    const tasks = mapped.map((t) => ({
      ...t,
      // Orphaned tasks (parent filtered out): promote to root
      parent: t.parent !== undefined && !taskIds.has(t.parent) ? undefined : t.parent,
      // open:true on a leaf causes SVAR to call null.forEach() — only expand real parents
      open: parentIds.has(t.id),
    }));

    const links = rawDeps.map(toSvarLink);
    set({ rawTasks, tasks, links });
  },

  applyTaskDateChange(taskId, newStart, newEnd) {
    const { tasks, links, rawTasks } = get();

    const duration = Math.max(1, Math.round((newEnd.getTime() - newStart.getTime()) / 86400000));

    // 1. Apply the user-dragged change to the root task.
    const withRoot = tasks.map((t) =>
      t.id === taskId ? { ...t, start_date: newStart, end_date: newEnd, duration } : t,
    );

    // 2. Propagate constraints to all FS/SS/FF/SF successors.
    const scheduled = scheduleSuccessors(taskId, withRoot, links);

    // 3. Sync rawTasks so the workload panel stays consistent.
    //    Only tasks whose SvarTask dates actually changed are updated.
    const updatedRaw = rawTasks.map((r) => {
      const after = scheduled.find((t) => t.id === r.id);
      const before = tasks.find((t) => t.id === r.id);
      if (!after || !before) return r;
      if (
        before.start_date.getTime() === after.start_date.getTime() &&
        before.end_date.getTime() === after.end_date.getTime()
      )
        return r;
      return { ...r, startDate: after.start_date, dueDate: after.end_date };
    });

    set({ tasks: scheduled, rawTasks: updatedRaw });
  },

  patchTask(taskId, patch) {
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)),
    }));
  },

  addLink(link) {
    set((state) => ({ links: [...state.links, link] }));
  },

  removeLink(linkId) {
    set((state) => ({ links: state.links.filter((l) => l.id !== linkId) }));
  },

  replaceLinkId(tempId, realId) {
    set((state) => ({
      links: state.links.map((l) => (l.id === tempId ? { ...l, id: realId } : l)),
    }));
  },
}));
