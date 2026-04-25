"use client";

import { useMemo, useState } from "react";

import dynamic from "next/dynamic";
import Link from "next/link";

import { ArrowLeft, Calendar } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { propagateSuccessors, updateTask } from "@/actions/tasks";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

import "gantt-task-react/dist/index.css";

const Gantt = dynamic(() => import("gantt-task-react").then((m) => m.Gantt), { ssr: false });

type RawTask = {
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
};

type Dep = {
  id: string;
  predecessorId: string;
  successorId: string;
  type: string;
  lagDays: number;
};

interface Props {
  tasks: RawTask[];
  dependencies: Dep[];
}

const STATUS_COLORS = {
  done: "#10b981",
  in_progress: "#6366f1",
  todo: "#94a3b8",
} as const;

const PRIORITY_DOT: Record<string, string> = {
  blocker: "#dc2626",
  critical: "#ea580c",
  high: "#ef4444",
  normal: "#6366f1",
  low: "#94a3b8",
};

function fmtDate(d: Date) {
  return d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export function TaskGantt({ tasks, dependencies }: Props) {
  const t = useTranslations("tasks.gantt");
  const [viewMode, setViewMode] = useState<"Day" | "Week" | "Month">("Week");
  const [localTasks, setLocalTasks] = useState<RawTask[]>(tasks);

  const done = localTasks.filter((r) => r.status === "done").length;
  const inProg = localTasks.filter((r) => r.status === "in_progress").length;
  const todo = localTasks.filter((r) => r.status === "todo").length;
  const withDates = localTasks.filter((r) => r.dueDate !== null).length;
  const total = localTasks.length;
  const donePct = withDates > 0 ? Math.round((done / withDates) * 100) : 0;

  const rawById = useMemo(() => {
    const m: Record<string, RawTask> = {};
    for (const r of localTasks) m[r.id] = r;
    return m;
  }, [localTasks]);

  const ganttTasks = useMemo(() => {
    const predMap: Record<string, string[]> = {};
    for (const dep of dependencies) {
      if (!predMap[dep.successorId]) predMap[dep.successorId] = [];
      predMap[dep.successorId].push(dep.predecessorId);
    }

    return localTasks
      .filter((r) => r.dueDate !== null)
      .map((r) => {
        // biome-ignore lint/style/noNonNullAssertion: filtered above
        const end = new Date(r.dueDate!);
        const start = r.startDate ? new Date(r.startDate) : new Date(end.getTime() - 86400000);
        if (start >= end) start.setTime(end.getTime() - 86400000);

        const color = STATUS_COLORS[(r.status as keyof typeof STATUS_COLORS) ?? "todo"] ?? STATUS_COLORS.todo;

        return {
          id: r.id,
          name: r.title,
          start,
          end,
          progress: r.status === "done" ? 100 : r.progressPct,
          type: "task" as const,
          dependencies: predMap[r.id] ?? [],
          project: r.parentId ?? undefined,
          styles: {
            backgroundColor: color,
            backgroundSelectedColor: color,
            progressColor: "rgba(255,255,255,0.28)",
            progressSelectedColor: "rgba(255,255,255,0.28)",
          },
        };
      });
  }, [localTasks, dependencies]);

  // Custom tooltip — closure over rawById and t
  const TooltipContent = useMemo(
    () =>
      function GanttTooltip({
        task,
      }: {
        task: {
          id: string;
          name: string;
          start: Date;
          end: Date;
          progress: number;
          styles?: { backgroundColor?: string };
        };
        fontSize: string;
        fontFamily: string;
      }) {
        const raw = rawById[task.id];
        return (
          <div className="w-52 rounded-xl border bg-background p-3 shadow-xl text-xs space-y-2">
            <p className="font-semibold text-sm leading-snug line-clamp-2">{task.name}</p>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${task.progress}%`,
                  backgroundColor: task.styles?.backgroundColor ?? "#6366f1",
                }}
              />
            </div>
            <div className="space-y-1 text-muted-foreground">
              <div className="flex justify-between">
                <span>{t("tooltipStart")}</span>
                <span className="font-medium text-foreground">{fmtDate(task.start)}</span>
              </div>
              <div className="flex justify-between">
                <span>{t("tooltipEnd")}</span>
                <span className="font-medium text-foreground">{fmtDate(task.end)}</span>
              </div>
              <div className="flex justify-between">
                <span>{t("tooltipProgress")}</span>
                <span className="font-medium text-foreground">{task.progress}%</span>
              </div>
              {raw?.assigneeName && (
                <div className="flex justify-between items-center">
                  <span>{t("tooltipAssignee")}</span>
                  <span className="font-medium text-foreground truncate max-w-[110px]">{raw.assigneeName}</span>
                </div>
              )}
              {raw?.priority && (
                <div className="flex justify-between items-center pt-0.5">
                  <span>{t("tooltipPriority")}</span>
                  <span
                    className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
                    style={{ backgroundColor: PRIORITY_DOT[raw.priority] ?? "#94a3b8" }}
                  >
                    {raw.priority}
                  </span>
                </div>
              )}
            </div>
          </div>
        );
      },
    [rawById, t],
  );

  // Custom list header
  const TaskListHeader = useMemo(
    () =>
      function GanttListHeader({
        headerHeight,
        rowWidth,
      }: {
        headerHeight: number;
        rowWidth: string;
        fontFamily: string;
        fontSize: string;
      }) {
        return (
          <div
            className="flex items-center border-r border-b bg-muted/30 px-3 font-semibold text-xs text-muted-foreground uppercase tracking-wide"
            style={{ height: headerHeight, width: rowWidth, minWidth: rowWidth }}
          >
            {t("listHeader")}
          </div>
        );
      },
    [t],
  );

  // Custom list table
  const TaskListTable = useMemo(
    () =>
      function GanttListTable({
        tasks: ganttList,
        rowHeight,
        rowWidth,
        selectedTaskId,
        setSelectedTask,
      }: {
        tasks: { id: string; name: string }[];
        rowHeight: number;
        rowWidth: string;
        fontFamily: string;
        fontSize: string;
        locale: string;
        selectedTaskId: string;
        setSelectedTask: (taskId: string) => void;
        onExpanderClick: (task: { id: string; name: string }) => void;
      }) {
        return (
          <div>
            {ganttList.map((task) => {
              const raw = rawById[task.id];
              const statusColor =
                STATUS_COLORS[(raw?.status as keyof typeof STATUS_COLORS) ?? "todo"] ?? STATUS_COLORS.todo;
              const priorityColor = raw?.priority ? (PRIORITY_DOT[raw.priority] ?? "#94a3b8") : null;
              const isSelected = task.id === selectedTaskId;
              const indent = raw?.depth ? raw.depth * 12 : 0;

              return (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => setSelectedTask(task.id)}
                  className={cn(
                    "flex w-full items-center gap-2 border-r border-b px-3 text-xs transition-colors cursor-pointer select-none",
                    isSelected ? "bg-muted" : "bg-background hover:bg-muted/40",
                  )}
                  style={{ height: rowHeight, width: rowWidth, minWidth: rowWidth }}
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ backgroundColor: statusColor, marginLeft: indent }}
                  />
                  {priorityColor && (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: priorityColor }} />
                  )}
                  <span className="flex-1 truncate font-medium text-foreground/90">{task.name}</span>
                  {raw?.assigneeName && (
                    <span className="h-5 w-5 shrink-0 rounded-full bg-muted border flex items-center justify-center text-[9px] font-bold text-muted-foreground">
                      {initials(raw.assigneeName)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        );
      },
    [rawById],
  );

  const handleDateChange = async (updatedTask: { id: string; start: Date; end: Date }) => {
    const original = localTasks.find((r) => r.id === updatedTask.id);
    if (!original) return;

    setLocalTasks((prev) =>
      prev.map((r) => (r.id === updatedTask.id ? { ...r, startDate: updatedTask.start, dueDate: updatedTask.end } : r)),
    );

    try {
      const deltaDays = original.dueDate
        ? Math.round((updatedTask.end.getTime() - original.dueDate.getTime()) / 86400000)
        : 0;

      await updateTask(updatedTask.id, { startDate: updatedTask.start, dueDate: updatedTask.end }, "/dashboard/tasks");

      if (deltaDays !== 0) {
        const count = await propagateSuccessors(updatedTask.id, deltaDays);
        if (count > 0) toast.info(t("propagated", { count }));
      }
    } catch {
      toast.error(t("updateDateError"));
      setLocalTasks(tasks);
    }
  };

  const colWidth = viewMode === "Day" ? 44 : viewMode === "Week" ? 140 : 220;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="flex shrink-0 flex-col gap-3 border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" asChild className="h-8 w-8">
              <Link href="/dashboard/tasks">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-muted-foreground" />
              <h1 className="font-semibold text-lg">{t("title")}</h1>
            </div>
            <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {t("tasksWithDates", { withDates, total })}
            </span>
          </div>
          <Select value={viewMode} onValueChange={(v) => setViewMode(v as typeof viewMode)}>
            <SelectTrigger className="h-8 w-32 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Day">{t("viewDay")}</SelectItem>
              <SelectItem value="Week">{t("viewWeek")}</SelectItem>
              <SelectItem value="Month">{t("viewMonth")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Legend + progress bar */}
        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-3">
            {(
              [
                ["done", t("legendDone"), done],
                ["in_progress", t("legendInProgress"), inProg],
                ["todo", t("legendTodo"), todo],
              ] as [keyof typeof STATUS_COLORS, string, number][]
            ).map(([key, label, count]) => (
              <span key={key} className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: STATUS_COLORS[key] }} />
                <span className="text-muted-foreground">{label}</span>
                <span className="font-semibold tabular-nums">{count}</span>
              </span>
            ))}
          </div>
          {withDates > 0 && (
            <>
              <span className="text-border select-none">|</span>
              <div className="flex items-center gap-2 text-muted-foreground">
                <div className="h-1.5 w-28 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${donePct}%`, backgroundColor: STATUS_COLORS.done }}
                  />
                </div>
                <span>
                  <span className="font-semibold text-foreground">{donePct}%</span> {t("progressLabel")}
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Gantt body */}
      <div className="flex-1 min-h-0 overflow-auto">
        {ganttTasks.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-2 text-muted-foreground">
            <Calendar className="h-10 w-10 opacity-30" />
            <p className="text-sm">{t("noTasksTitle")}</p>
            <p className="text-xs opacity-60">{t("noTasksHint")}</p>
          </div>
        ) : (
          <Gantt
            tasks={ganttTasks}
            viewMode={viewMode as any}
            locale="it-IT"
            onDateChange={handleDateChange as any}
            listCellWidth="220px"
            columnWidth={colWidth}
            rowHeight={42}
            headerHeight={50}
            barFill={72}
            barCornerRadius={3}
            arrowColor="#94a3b8"
            arrowIndent={16}
            todayColor="rgba(99,102,241,0.12)"
            fontSize="12px"
            TooltipContent={TooltipContent as any}
            TaskListHeader={TaskListHeader as any}
            TaskListTable={TaskListTable as any}
          />
        )}
      </div>
    </div>
  );
}
