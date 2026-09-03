"use client";

import { useMemo } from "react";

import Link from "next/link";

import { isWeekend } from "date-fns";
import { BarChart3, ExternalLink, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { RawTask } from "@/stores/gantt-store";
import { useGanttStore } from "@/stores/gantt-store";

// ─── Constants ────────────────────────────────────────────────────────────────

const CAPACITY = 8;
const VISIBLE_DAYS = 14; // 2 working weeks

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getNextWorkingDays(from: Date, count: number): Date[] {
  const days: Date[] = [];
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  while (days.length < count) {
    if (!isWeekend(d)) days.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

function getWorkingDaysInRange(start: Date, end: Date): Date[] {
  const days: Date[] = [];
  const d = new Date(start);
  d.setHours(0, 0, 0, 0);
  const e = new Date(end);
  e.setHours(23, 59, 59, 999);
  while (d <= e) {
    if (!isWeekend(d)) days.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

function userInitials(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

type UserLoad = {
  userId: string;
  name: string;
  initials: string;
  dayHours: Record<string, number>;
  conflicts: number;
};

function computeWorkload(tasks: RawTask[], visibleDays: Date[]): { users: UserLoad[]; totalConflicts: number } {
  const visibleSet = new Set(visibleDays.map(toDateStr));
  const userMap = new Map<string, { name: string; dayHours: Record<string, number> }>();

  for (const task of tasks) {
    if (!task.assigneeId || !task.startDate || !task.dueDate || !task.estimatedHours) continue;
    const taskDays = getWorkingDaysInRange(task.startDate, task.dueDate);
    if (taskDays.length === 0) continue;
    const hoursPerDay = task.estimatedHours / taskDays.length;

    let user = userMap.get(task.assigneeId);
    if (!user) {
      user = { name: task.assigneeName ?? task.assigneeId, dayHours: {} };
      userMap.set(task.assigneeId, user);
    }

    for (const day of taskDays) {
      const ds = toDateStr(day);
      if (!visibleSet.has(ds)) continue;
      user.dayHours[ds] = (user.dayHours[ds] ?? 0) + hoursPerDay;
    }
  }

  let totalConflicts = 0;
  const users: UserLoad[] = [...userMap.entries()]
    .map(([userId, { name, dayHours }]) => {
      const conflicts = Object.values(dayHours).filter((h) => h > CAPACITY).length;
      totalConflicts += conflicts;
      return { userId, name, initials: userInitials(name), dayHours, conflicts };
    })
    .sort((a, b) => b.conflicts - a.conflicts);

  return { users, totalConflicts };
}

function cellBg(hours: number): string {
  if (hours === 0) return "bg-muted/40";
  const pct = hours / CAPACITY;
  if (pct > 1) return "bg-red-500";
  if (pct >= 0.9) return "bg-orange-400";
  if (pct >= 0.7) return "bg-yellow-400";
  if (pct >= 0.4) return "bg-emerald-400";
  return "bg-emerald-300/70 dark:bg-emerald-600/50";
}

// ─── Exported hook (used by toolbar for badge) ────────────────────────────────

export function useWorkloadConflictCount(viewDate: Date): number {
  const rawTasks = useGanttStore((s) => s.rawTasks);
  return useMemo(() => {
    const days = getNextWorkingDays(viewDate, VISIBLE_DAYS);
    return computeWorkload(rawTasks, days).totalConflicts;
  }, [rawTasks, viewDate]);
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  viewDate: Date;
  onClose: () => void;
}

export function WorkloadPanel({ viewDate, onClose }: Props) {
  const t = useTranslations("tasks.gantt");
  const rawTasks = useGanttStore((s) => s.rawTasks);

  const visibleDays = useMemo(() => getNextWorkingDays(viewDate, VISIBLE_DAYS), [viewDate]);
  const { users, totalConflicts } = useMemo(() => computeWorkload(rawTasks, visibleDays), [rawTasks, visibleDays]);

  const todayStr = toDateStr(new Date());
  const week1Start = visibleDays[0];
  const week2Start = visibleDays[7];
  const periodEnd = visibleDays[visibleDays.length - 1];

  const fmtShort = (d: Date) => d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });

  return (
    <div className="flex w-80 shrink-0 flex-col border-l bg-background">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-muted-foreground" />
          <span className="font-semibold text-sm">{t("workloadPanelTitle")}</span>
          {totalConflicts > 0 && (
            <span className="rounded-full bg-red-100 px-1.5 py-0.5 font-bold text-[10px] text-red-700 dark:bg-red-900/40 dark:text-red-400">
              {totalConflicts}
            </span>
          )}
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Period label */}
      <div className="shrink-0 border-b px-4 py-2 text-[11px] text-muted-foreground">
        {week1Start && periodEnd && (
          <>
            {fmtShort(week1Start)}
            {" – "}
            {fmtShort(periodEnd)}
          </>
        )}
        <span className="ml-1 opacity-60">· {t("workloadNextDays", { n: VISIBLE_DAYS })}</span>
      </div>

      {/* Column headers: week labels + day initials */}
      <div className="flex shrink-0 items-end border-b py-1.5 pl-3">
        <div className="w-[76px] shrink-0" />
        <div className="flex flex-col gap-0.5">
          {/* Week labels */}
          <div className="flex gap-px">
            {[0, 1].map((wk) => {
              const wkDays = visibleDays.slice(wk * 7, wk * 7 + 7);
              const label = wk === 0 ? fmtShort(week1Start) : week2Start ? fmtShort(week2Start) : "";
              return (
                <div key={wk} className="flex items-center" style={{ width: `${wkDays.length * 15}px` }}>
                  <span className="truncate font-medium text-[9px] text-muted-foreground/70">{label}</span>
                </div>
              );
            })}
          </div>
          {/* Day initials */}
          <div className="flex gap-px">
            {visibleDays.map((d) => {
              const ds = toDateStr(d);
              const isToday = ds === todayStr;
              return (
                <div
                  key={ds}
                  className={cn(
                    "flex w-[14px] items-center justify-center text-[8px]",
                    isToday ? "font-bold text-primary" : "text-muted-foreground/60",
                  )}
                >
                  {d.toLocaleDateString(undefined, { weekday: "narrow" })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* User rows */}
      {users.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center text-muted-foreground">
          <BarChart3 className="h-8 w-8 opacity-20" aria-hidden="true" />
          <p className="text-xs">{t("workloadNoData")}</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto py-1">
          {users.map((user) => (
            <div key={user.userId} className="flex items-center py-1.5 pl-3">
              {/* User info — 76px */}
              <div className="flex w-[76px] shrink-0 items-center gap-1.5 overflow-hidden">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border bg-muted font-bold text-[8px] text-muted-foreground">
                  {user.initials}
                </span>
                <span className="truncate font-medium text-[11px]">{user.name.split(" ")[0]}</span>
              </div>
              {/* Day cells — 14px each with 1px gap (14×14+13×1 = 209px) */}
              <div className="flex gap-px">
                {visibleDays.map((d) => {
                  const ds = toDateStr(d);
                  const hours = user.dayHours[ds] ?? 0;
                  const isToday = ds === todayStr;
                  return (
                    <div
                      key={ds}
                      className={cn(
                        "h-5 w-[14px] shrink-0 rounded-[2px]",
                        cellBg(hours),
                        isToday && "ring-1 ring-primary ring-offset-[1px]",
                      )}
                      title={
                        hours > 0
                          ? `${user.name} · ${d.toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short" })} · ${hours.toFixed(1)}h`
                          : undefined
                      }
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Legend */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t px-4 py-2">
        {[
          { bg: "bg-emerald-300/70 dark:bg-emerald-600/50", label: "≤50%" },
          { bg: "bg-emerald-400", label: "≤70%" },
          { bg: "bg-yellow-400", label: "≤90%" },
          { bg: "bg-orange-400", label: "≤100%" },
          { bg: "bg-red-500", label: ">100%" },
        ].map(({ bg, label }) => (
          <span key={label} className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <span className={cn("h-2.5 w-2.5 rounded-sm", bg)} />
            {label}
          </span>
        ))}
      </div>

      {/* Footer link */}
      <div className="shrink-0 border-t px-4 py-2.5">
        <Link
          href="/dashboard/tasks/workload"
          className="flex items-center gap-1 text-[11px] text-primary transition-opacity hover:opacity-70"
        >
          <ExternalLink className="h-3 w-3" />
          {t("workloadViewFull")}
        </Link>
      </div>
    </div>
  );
}
