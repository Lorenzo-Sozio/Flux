"use client";

import { useCallback, useRef, useState } from "react";

import dynamic from "next/dynamic";

import { defaultColumns } from "@svar-ui/gantt-store";
import type { IApi, IScaleConfig, TMethodsConfig } from "@svar-ui/react-gantt";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { addDependency, getTaskById, propagateSuccessors, removeDependency, updateTask } from "@/actions/tasks";
import { TaskModal } from "@/components/crm/task-modal";
import type { SvarLink, SvarTask } from "@/stores/gantt-store";
import { useGanttStore } from "@/stores/gantt-store";

// Full SVAR CSS bundle — includes base theme vars (--wx-background, --wx-font-*, etc.)
import "@svar-ui/react-gantt/all.css";

// Dynamic import: Gantt uses browser-only APIs, skip SSR
const SvarGantt = dynamic(() => import("@svar-ui/react-gantt").then((m) => m.Gantt), {
  ssr: false,
  loading: () => <GanttSkeleton />,
});

// ─── Scale configs per view mode ──────────────────────────────────────────────
// SVAR uses strftime tokens: %j=day-no-pad, %D=short-day, %F=full-month,
// %M=short-month, %Y=year, %w=week-number (locale start).

const SCALES: Record<"Day" | "Week" | "Month", IScaleConfig[]> = {
  Day: [
    { unit: "month", step: 1, format: "%F %Y" },
    { unit: "day", step: 1, format: "%j %D" },
  ],
  Week: [
    { unit: "month", step: 1, format: "%F %Y" },
    { unit: "week", step: 1, format: "W%w" },
  ],
  Month: [
    { unit: "year", step: 1, format: "%Y" },
    { unit: "month", step: 1, format: "%M" },
  ],
};

const CELL_WIDTHS: Record<"Day" | "Week" | "Month", number> = {
  Day: 44,
  Week: 110,
  Month: 90,
};

// ─── Data mapping: store format → SVAR component format ──────────────────────

function toSvarComponentTask(t: SvarTask) {
  return {
    id: t.id,
    text: t.text,
    start: t.start_date,
    end: t.end_date,
    duration: t.duration,
    progress: t.progress,
    parent: t.parent ?? 0,
    open: t.open,
    type: "task" as const,
    status: t.status,
    priority: t.priority,
    assigneeName: t.assigneeName,
  };
}

function toSvarComponentLink(l: SvarLink) {
  return { id: l.id, source: l.source, target: l.target, type: l.type, lag: l.lagDays };
}

// ─── Skeleton shown while the dynamic bundle loads ────────────────────────────

function GanttSkeleton() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}

// ─── SVAR type → DB dependency type ──────────────────────────────────────────

const SVAR_TO_DEP: Record<string, "FS" | "SS" | "FF" | "SF"> = {
  e2s: "FS",
  s2s: "SS",
  e2e: "FF",
  s2e: "SF",
};

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  viewMode: "Day" | "Week" | "Month";
  viewDate: Date;
  users: { id: string; name: string | null }[];
}

export function GanttView({ viewMode, viewDate, users }: Props) {
  const t = useTranslations("tasks.gantt");
  const applyTaskDateChange = useGanttStore((s) => s.applyTaskDateChange);
  const addLink = useGanttStore((s) => s.addLink);
  const removeLink = useGanttStore((s) => s.removeLink);
  const replaceLinkId = useGanttStore((s) => s.replaceLinkId);

  // Snapshot store data at mount — SVAR manages its own internal state after
  // init. Parent remounts via `key` when server data is refreshed.
  const [initialData] = useState(() => {
    const { tasks, links } = useGanttStore.getState();
    return {
      tasks: tasks.map(toSvarComponentTask),
      links: links.map(toSvarComponentLink),
    };
  });

  // Prevents our own api.exec() calls from re-triggering event listeners
  const isSchedulerPush = useRef(false);
  // Maps SVAR temp IDs to real DB UUIDs after server confirmation
  const tempToReal = useRef<Map<string, string>>(new Map());

  // ─── Task detail modal ──────────────────────────────────────────────────────
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  // biome-ignore lint/suspicious/noExplicitAny: mirrors TaskModal task prop type
  const [modalTask, setModalTask] = useState<any | null>(null);

  const openTask = useCallback((id: string) => {
    setOpenTaskId(id);
    getTaskById(id).then((task) => {
      if (task) setModalTask(task);
    });
  }, []);

  // ─── SVAR event handlers ────────────────────────────────────────────────────

  const handleInit = useCallback(
    (api: IApi) => {
      api.intercept("add-task", () => false);
      api.intercept("delete-task", () => false);

      // Double-click on task bar or row opens our modal instead of SVAR's built-in editor
      api.intercept("show-editor", (ev: TMethodsConfig["show-editor"]) => {
        openTask(String(ev.id));
        return false;
      });

      api.on("update-task", async (ev: TMethodsConfig["update-task"]) => {
        if (ev.inProgress) return;
        if (isSchedulerPush.current) return;

        const { start, end } = ev.task;
        if (!start || !end) return;

        const id = String(ev.id);

        const beforeTasks = useGanttStore.getState().tasks;
        const originalDueDate = beforeTasks.find((bt) => bt.id === id)?.end_date ?? null;

        applyTaskDateChange(id, start, end);

        const afterTasks = useGanttStore.getState().tasks;

        isSchedulerPush.current = true;
        for (const after of afterTasks) {
          if (after.id === id) continue;
          const before = beforeTasks.find((b) => b.id === after.id);
          if (!before) continue;
          if (
            before.start_date.getTime() !== after.start_date.getTime() ||
            before.end_date.getTime() !== after.end_date.getTime()
          ) {
            api.exec("update-task", {
              id: after.id,
              task: { start: after.start_date, end: after.end_date, duration: after.duration },
            });
          }
        }
        isSchedulerPush.current = false;

        try {
          await updateTask(id, { startDate: start, dueDate: end }, "/dashboard/tasks");

          if (originalDueDate) {
            const deltaDays = Math.round((end.getTime() - originalDueDate.getTime()) / 86400000);
            if (deltaDays !== 0) {
              const count = await propagateSuccessors(id, deltaDays);
              if (count > 0) toast.info(t("propagated", { count }));
            }
          }
        } catch {
          toast.error(t("updateDateError"));
        }
      });

      api.on("add-link", async (ev: TMethodsConfig["add-link"]) => {
        if (isSchedulerPush.current) return;
        const { link } = ev;
        if (!link.source || !link.target) return;

        const tempId = String(link.id ?? ev.id ?? `temp://${Date.now()}`);
        const svarType = (link.type ?? "e2s") as SvarLink["type"];
        const depType = SVAR_TO_DEP[svarType] ?? "FS";

        const optimistic: SvarLink = {
          id: tempId,
          source: String(link.source),
          target: String(link.target),
          type: svarType,
          lagDays: 0,
          depType,
        };
        addLink(optimistic);

        try {
          const realId = await addDependency(String(link.source), String(link.target), depType, 0);
          tempToReal.current.set(tempId, realId);
          replaceLinkId(tempId, realId);
        } catch {
          removeLink(tempId);
          isSchedulerPush.current = true;
          api.exec("delete-link", { id: tempId });
          isSchedulerPush.current = false;
          toast.error(t("addLinkError"));
        }
      });

      api.on("delete-link", async (ev: TMethodsConfig["delete-link"]) => {
        if (isSchedulerPush.current) return;
        const tempId = String(ev.id);
        if (tempId.startsWith("temp://")) return;

        const realId = tempToReal.current.get(tempId) ?? tempId;
        removeLink(tempId);

        try {
          await removeDependency(realId);
        } catch {
          toast.error(t("deleteLinkError"));
        }
      });
    },
    [applyTaskDateChange, addLink, removeLink, replaceLinkId, openTask, t],
  );

  if (initialData.tasks.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 text-muted-foreground">
        <CalendarIconEmpty />
        <p className="text-sm">{t("noTasksTitle")}</p>
        <p className="text-xs opacity-60">{t("noTasksHint")}</p>
      </div>
    );
  }

  return (
    // wx-theme + wx-willow-theme activate SVAR CSS variables scoped to this subtree.
    // React 19 hoists the <link> to <head> — no duplicate requests across re-renders.
    <div className="relative min-h-0 min-w-0 flex-1">
      <div className="wx-theme wx-willow-theme h-full overflow-hidden">
        <link rel="preconnect" href="https://cdn.svar.dev" crossOrigin="anonymous" />
        <link rel="stylesheet" href="https://cdn.svar.dev/fonts/wxi/wx-icons.css" />
        <SvarGantt
          tasks={initialData.tasks}
          links={initialData.links}
          scales={SCALES[viewMode]}
          start={viewDate}
          cellWidth={CELL_WIDTHS[viewMode]}
          cellHeight={38}
          zoom
          columns={[
            { ...defaultColumns[0], header: t("listHeader") },
            { ...defaultColumns[1], header: t("colStart") },
            { ...defaultColumns[2], header: t("colDuration") },
          ]}
          init={handleInit}
        />
      </div>

      {/* Task detail modal — key ensures fresh mount per task */}
      {modalTask && openTaskId === modalTask.id && (
        <TaskModal
          key={modalTask.id}
          task={modalTask}
          users={users}
          revalidatePathStr="/dashboard/tasks/gantt"
          defaultOpen
          onUpdated={() => setModalTask(null)}
        />
      )}
    </div>
  );
}

function CalendarIconEmpty() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-10 w-10 opacity-30"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
      />
    </svg>
  );
}
