"use client";

import { useMemo, useState, useTransition } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  CalendarClock,
  CalendarIcon,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  Users,
  X,
  Zap,
} from "lucide-react";
import { useTranslations } from "next-intl";
import type { DateRange } from "react-day-picker";
import { toast } from "sonner";

import type { WorkloadCell, WorkloadRow, WorkloadTaskEntry } from "@/actions/workload";
import { getWorkloadMatrix, rescheduleTaskDueDate } from "@/actions/workload";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  matrix: WorkloadRow[];
  startDate: Date;
  endDate: Date;
}

type SelectedCell = {
  userId: string;
  userName: string;
  date: string;
  cell: WorkloadCell;
} | null;

type ConflictEntry = {
  userId: string;
  userName: string;
  date: string;
  cell: WorkloadCell;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const _today = new Date();
const TODAY_STR = `${_today.getFullYear()}-${String(_today.getMonth() + 1).padStart(2, "0")}-${String(_today.getDate()).padStart(2, "0")}`;

type CellTheme = { bg: string; text: string; bar: string };

function cellTheme(hours: number, capacity: number): CellTheme {
  if (hours === 0) return { bg: "", text: "text-muted-foreground/25", bar: "" };
  const pct = hours / capacity;
  if (pct > 1)
    return { bg: "bg-red-500/15 dark:bg-red-900/25", text: "text-red-700 dark:text-red-400", bar: "#ef4444" };
  if (pct >= 0.9)
    return {
      bg: "bg-orange-400/15 dark:bg-orange-900/20",
      text: "text-orange-700 dark:text-orange-400",
      bar: "#f97316",
    };
  if (pct >= 0.7)
    return {
      bg: "bg-yellow-400/15 dark:bg-yellow-900/20",
      text: "text-yellow-700 dark:text-yellow-400",
      bar: "#eab308",
    };
  if (pct >= 0.4)
    return {
      bg: "bg-emerald-400/15 dark:bg-emerald-900/15",
      text: "text-emerald-700 dark:text-emerald-400",
      bar: "#10b981",
    };
  return {
    bg: "bg-emerald-300/10 dark:bg-emerald-950/20",
    text: "text-emerald-600 dark:text-emerald-500",
    bar: "#10b981",
  };
}

function utilBarColor(pct: number) {
  if (pct > 1) return "bg-red-500";
  if (pct >= 0.9) return "bg-orange-500";
  if (pct >= 0.7) return "bg-yellow-500";
  return "bg-emerald-500";
}

function userInitials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function getDays(start: Date, end: Date): Date[] {
  const days: Date[] = [];
  const d = new Date(start);
  d.setHours(0, 0, 0, 0);
  while (d <= end) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) days.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

function addWorkingDays(from: Date, n: number): Date {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  let added = 0;
  while (added < n) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) added++;
  }
  return d;
}

function getMondayOf(d: Date): Date {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay();
  date.setDate(date.getDate() + (day === 0 ? -6 : 1 - day));
  return date;
}

// Returns the minimum due date to keep daily load ≤ 8h, starting from today
function suggestMinDueDate(task: WorkloadTaskEntry): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const minWorkDays = Math.ceil(task.estimatedHours / 8);
  return addWorkingDays(today, minWorkDays);
}

function formatDate(d: Date): string {
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

function toLocalStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const LEGEND = [
  { bg: "bg-emerald-300/30 dark:bg-emerald-900/30", label: "≤70%" },
  { bg: "bg-yellow-400/30 dark:bg-yellow-900/30", label: "70–90%" },
  { bg: "bg-orange-400/30 dark:bg-orange-900/30", label: "90–100%" },
  { bg: "bg-red-500/30 dark:bg-red-900/30", label: ">100%" },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function TaskCard({
  task,
  cellHours,
  showReschedule,
  rescheduling,
  onReschedule,
}: {
  task: WorkloadTaskEntry;
  cellHours: number;
  showReschedule: boolean;
  rescheduling: boolean;
  onReschedule: (taskId: string, newDate: Date) => void;
}) {
  const taskPct = cellHours > 0 ? task.hours / cellHours : 0;
  const minDate = suggestMinDueDate(task);
  const minDateStr = toLocalStr(minDate);
  const currentDue = new Date(`${task.dueDate}T00:00:00`);
  const needsPostpone = minDate > currentDue;

  const [pickedDate, setPickedDate] = useState(minDateStr);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = toLocalStr(today);

  return (
    <div className="space-y-1.5 rounded-lg border bg-card px-3 py-2 transition-colors hover:bg-muted/40">
      <div className="flex items-start justify-between gap-2">
        <span className="flex-1 font-medium text-xs leading-snug">{task.title}</span>
        <div className="flex shrink-0 items-center gap-1">
          <span className="rounded bg-muted px-1.5 py-0.5 font-semibold text-[10px] tabular-nums">
            {task.hours.toFixed(1)}h/g
          </span>
          <Link
            href={`/dashboard/tasks?task=${task.id}`}
            className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="Apri attività"
          >
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      </div>

      <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-indigo-500/60 transition-all"
          style={{ width: `${Math.min(taskPct * 100, 100)}%` }}
        />
      </div>

      {/* Reschedule suggestion */}
      {showReschedule && needsPostpone && (
        <div className="mt-1 rounded border border-orange-200 bg-orange-50 px-2 py-1.5 text-[11px] dark:border-orange-800 dark:bg-orange-950/20">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="flex items-center gap-1 text-muted-foreground">
              <CalendarClock className="h-3 w-3 shrink-0" />
              Suggerita dal sistema:
            </span>
            <span className="flex items-center gap-1.5">
              <strong className="font-semibold text-orange-700 dark:text-orange-400">{formatDate(minDate)}</strong>
              {pickedDate !== minDateStr && (
                <button
                  type="button"
                  onClick={() => setPickedDate(minDateStr)}
                  className="text-[10px] text-muted-foreground underline underline-offset-2 hover:text-orange-700 dark:hover:text-orange-400"
                >
                  ripristina
                </button>
              )}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={pickedDate}
              min={todayStr}
              onChange={(e) => setPickedDate(e.target.value)}
              className="h-6 flex-1 rounded border border-orange-300 bg-white px-1.5 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-orange-400 dark:border-orange-700 dark:bg-background"
            />
            <button
              type="button"
              disabled={rescheduling || !pickedDate}
              onClick={() => onReschedule(task.id, new Date(`${pickedDate}T00:00:00`))}
              className="flex shrink-0 items-center gap-1 rounded bg-orange-500/10 px-2 py-1 font-medium text-[10px] text-orange-700 transition-colors hover:bg-orange-500/20 disabled:opacity-50 dark:text-orange-400"
            >
              {rescheduling ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Zap className="h-2.5 w-2.5" />}
              Applica
            </button>
          </div>
          <p className="mt-1.5 text-[10px] text-muted-foreground">
            {task.estimatedHours.toFixed(0)}h stimate · {Math.ceil(task.estimatedHours / 8)} gg lavorativi min.
          </p>
        </div>
      )}
      {showReschedule && !needsPostpone && (
        <p className="mt-0.5 flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
          <CalendarClock className="h-3 w-3" />
          Scadenza adeguata al carico stimato
        </p>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function WorkloadClient({ matrix, startDate }: Props) {
  const t = useTranslations("tasks.workload");
  const router = useRouter();
  const [, startRouterTransition] = useTransition();

  // ── Period state ────────────────────────────────────────────────────────────
  const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>(() => {
    const from = getMondayOf(startDate);
    return { from, to: new Date(from.getTime() + 13 * 86400000) };
  });
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [currentMatrix, setCurrentMatrix] = useState<WorkloadRow[]>(matrix);
  const [isFetching, setIsFetching] = useState(false);

  const periodStart = dateRange.from;
  const periodEnd = dateRange.to;

  const todayMondayStr = toLocalStr(getMondayOf(new Date()));
  const isCurrentRange = toLocalStr(periodStart) === todayMondayStr;

  // ── Panel state ─────────────────────────────────────────────────────────────
  const [selected, setSelected] = useState<SelectedCell>(null);
  const [showConflicts, setShowConflicts] = useState(false);
  const [reschedulingIds, setReschedulingIds] = useState<Set<string>>(new Set());
  const [resolvingAll, setResolvingAll] = useState(false);

  // ── Grid data ───────────────────────────────────────────────────────────────
  const days = getDays(periodStart, periodEnd);

  const weekGroups: Date[][] = [];
  for (let i = 0; i < days.length; i += 5) {
    weekGroups.push(days.slice(i, i + 5));
  }

  const totalConflicts = currentMatrix.reduce(
    (sum, row) => sum + Object.values(row.days).filter((c) => c.hours > c.capacity).length,
    0,
  );

  const conflicts: ConflictEntry[] = useMemo(
    () =>
      currentMatrix
        .flatMap((row) =>
          Object.entries(row.days)
            .filter(([, cell]) => cell.hours > cell.capacity)
            .map(([date, cell]) => ({ userId: row.userId, userName: row.userName, date, cell })),
        )
        .sort((a, b) => a.date.localeCompare(b.date)),
    [currentMatrix],
  );

  const nonEmptyCells = currentMatrix.flatMap((row) => Object.values(row.days)).filter((c) => c.hours > 0);
  const avgUtil =
    nonEmptyCells.length > 0
      ? Math.round((nonEmptyCells.reduce((s, c) => s + c.hours / c.capacity, 0) / nonEmptyCells.length) * 100)
      : 0;

  // ── Fetch ───────────────────────────────────────────────────────────────────
  const fetchMatrix = async (start: Date, end: Date) => {
    setIsFetching(true);
    try {
      const newMatrix = await getWorkloadMatrix(start, end);
      setCurrentMatrix(newMatrix);
    } catch {
      toast.error("Errore nel caricamento dei dati");
    } finally {
      setIsFetching(false);
    }
  };

  // ── Navigation handlers ─────────────────────────────────────────────────────
  const handleRangeSelect = (range: DateRange | undefined) => {
    if (!range?.from || !range.to) return;
    const newRange = { from: range.from, to: range.to };
    setDateRange(newRange);
    setSelected(null);
    setShowConflicts(false);
    fetchMatrix(newRange.from, newRange.to);
    setPopoverOpen(false);
  };

  const handleToday = () => {
    const from = getMondayOf(new Date());
    const to = new Date(from.getTime() + 13 * 86400000);
    setDateRange({ from, to });
    setSelected(null);
    setShowConflicts(false);
    fetchMatrix(from, to);
  };

  const handlePrev = () => {
    const rangeMs = periodEnd.getTime() - periodStart.getTime();
    const from = new Date(periodStart.getTime() - 7 * 86400000);
    const to = new Date(from.getTime() + rangeMs);
    setDateRange({ from, to });
    setSelected(null);
    setShowConflicts(false);
    fetchMatrix(from, to);
  };

  const handleNext = () => {
    const rangeMs = periodEnd.getTime() - periodStart.getTime();
    const from = new Date(periodStart.getTime() + 7 * 86400000);
    const to = new Date(from.getTime() + rangeMs);
    setDateRange({ from, to });
    setSelected(null);
    setShowConflicts(false);
    fetchMatrix(from, to);
  };

  // ── Cell / reschedule handlers ──────────────────────────────────────────────
  const handleCellClick = (row: WorkloadRow, date: string, cell: WorkloadCell) => {
    if (cell.hours === 0) return;
    setShowConflicts(false);
    setSelected(
      selected?.userId === row.userId && selected?.date === date
        ? null
        : { userId: row.userId, userName: row.userName, date, cell },
    );
  };

  const handleReschedule = async (taskId: string, newDate: Date) => {
    setReschedulingIds((prev) => new Set(prev).add(taskId));
    try {
      const res = await rescheduleTaskDueDate(taskId, newDate);
      if (!res.success) throw new Error(res.error);
      toast.success(`Scadenza spostata al ${formatDate(newDate)}`);
      setSelected(null);
      fetchMatrix(periodStart, periodEnd);
      startRouterTransition(() => router.refresh());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Aggiornamento fallito");
    } finally {
      setReschedulingIds((prev) => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
    }
  };

  const handleResolveAll = async () => {
    const taskMap = new Map<string, { task: WorkloadTaskEntry; newDate: Date }>();
    for (const conflict of conflicts) {
      for (const task of conflict.cell.tasks) {
        if (taskMap.has(task.id)) continue;
        const minDate = suggestMinDueDate(task);
        const currentDue = new Date(`${task.dueDate}T00:00:00`);
        if (minDate > currentDue) taskMap.set(task.id, { task, newDate: minDate });
      }
    }
    if (taskMap.size === 0) {
      toast.info("Nessuna attività da posticipare");
      return;
    }
    setResolvingAll(true);
    try {
      const results = await Promise.all(
        [...taskMap.values()].map(({ task, newDate }) => rescheduleTaskDueDate(task.id, newDate)),
      );
      const failed = results.filter((r) => !r.success).length;
      if (failed > 0) toast.error(`${failed} attività non aggiornate`);
      else toast.success(`${taskMap.size} attività ripianificate`);
      setSelected(null);
      setShowConflicts(false);
      fetchMatrix(periodStart, periodEnd);
      startRouterTransition(() => router.refresh());
    } finally {
      setResolvingAll(false);
    }
  };

  const panelOpen = selected !== null || showConflicts;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="flex shrink-0 flex-col gap-2 border-b px-6 py-3">
        {/* Row 1: back + title | legend */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" asChild className="h-8 w-8">
              <Link href="/dashboard/tasks">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <BarChart3 className="h-5 w-5 text-muted-foreground" />
            <h1 className="font-semibold text-lg">{t("title")}</h1>
          </div>
          <div className="flex items-center gap-3 text-[11px]">
            <span className="font-medium text-muted-foreground">{t("legend")}:</span>
            {LEGEND.map(({ bg, label }) => (
              <span key={label} className="flex items-center gap-1">
                <span className={cn("h-3 w-3 rounded", bg)} />
                <span className="text-muted-foreground">{label}</span>
              </span>
            ))}
          </div>
        </div>

        {/* Row 2: date range picker | conflicts */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-3"
              onClick={handleToday}
              disabled={isCurrentRange || isFetching}
            >
              Oggi
            </Button>

            <Button variant="outline" size="icon" className="h-8 w-8" onClick={handlePrev} disabled={isFetching}>
              <ChevronLeft className="h-4 w-4" />
            </Button>

            <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="h-8 gap-2 px-3 font-normal text-sm" disabled={isFetching}>
                  {isFetching ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  ) : (
                    <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                  <span>
                    {periodStart.toLocaleDateString(undefined, { day: "2-digit", month: "short" })}
                    {" – "}
                    {periodEnd.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}
                  </span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="range"
                  selected={{ from: periodStart, to: periodEnd }}
                  onSelect={handleRangeSelect}
                  numberOfMonths={2}
                />
              </PopoverContent>
            </Popover>

            <Button variant="outline" size="icon" className="h-8 w-8" onClick={handleNext} disabled={isFetching}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {totalConflicts > 0 && (
            <button
              type="button"
              onClick={() => {
                setSelected(null);
                setShowConflicts((v) => !v);
              }}
              className={cn(
                "flex items-center gap-1 rounded-full px-2.5 py-0.5 font-medium text-[11px] transition-colors",
                showConflicts
                  ? "bg-red-600 text-white"
                  : "bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50",
              )}
            >
              <AlertTriangle className="h-3 w-3" />
              {totalConflicts} {totalConflicts === 1 ? "giorno in sovraccarico" : "giorni in sovraccarico"}
            </button>
          )}
        </div>

        {/* Row 3: stats */}
        {currentMatrix.length > 0 && (
          <div className="flex items-center gap-5 text-xs">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Users className="h-3.5 w-3.5" />
              {t("membersCount", { count: currentMatrix.length })}
            </span>
            <span className="select-none text-border">|</span>
            <span className="flex items-center gap-2">
              <span className="text-muted-foreground">{t("avgUtilLabel")}</span>
              <span className="font-semibold tabular-nums">{avgUtil}%</span>
              <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn("h-full rounded-full transition-all", utilBarColor(avgUtil / 100))}
                  style={{ width: `${Math.min(avgUtil, 100)}%` }}
                />
              </div>
            </span>
            {totalConflicts === 0 && (
              <span className="flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400">
                <span>✓</span>
                {t("noConflicts")}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Grid */}
        <div className="relative flex-1 overflow-auto">
          {/* Loading overlay */}
          {isFetching && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/60 backdrop-blur-[1px]">
              <div className="flex items-center gap-2 rounded-lg border bg-card px-4 py-2.5 shadow-md text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                Caricamento…
              </div>
            </div>
          )}

          {currentMatrix.length === 0 && !isFetching ? (
            <div className="flex h-64 flex-col items-center justify-center gap-2 text-muted-foreground">
              <BarChart3 className="h-10 w-10 opacity-30" />
              <p className="text-sm">{t("noTasksTitle")}</p>
              <p className="text-xs opacity-60">{t("noTasksHint")}</p>
            </div>
          ) : (
            // A week per column and a person per row: the grid is wider than any
            // phone by design, so it scrolls sideways inside its card.
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  {/* Week groups */}
                  <tr>
                    <th className="sticky left-0 z-10 min-w-[168px] border-r border-b bg-muted/20 px-3 py-2 text-left font-semibold text-[11px] text-muted-foreground uppercase tracking-wide">
                      {t("teamMember")}
                    </th>
                    {weekGroups.map((week, wi) => (
                      <th
                        key={week[0].toISOString()}
                        colSpan={week.length}
                        className="border-r border-b bg-muted/20 px-2 py-1.5 text-center font-semibold text-[11px] text-muted-foreground"
                      >
                        {t("weekLabel", { week: wi + 1 })}
                        <span className="ml-1.5 font-normal opacity-60">
                          {week[0].toLocaleDateString(undefined, { day: "2-digit", month: "2-digit" })}
                        </span>
                      </th>
                    ))}
                  </tr>
                  {/* Day headers */}
                  <tr>
                    <th className="sticky left-0 z-10 border-r border-b bg-background" />
                    {days.map((d) => {
                      const ds = d.toISOString().slice(0, 10);
                      const isToday = ds === TODAY_STR;
                      return (
                        <th
                          key={ds}
                          className={cn(
                            "min-w-[64px] whitespace-nowrap border-r border-b px-1 py-1.5 text-center",
                            isToday
                              ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-400"
                              : "bg-background text-muted-foreground",
                          )}
                        >
                          <div className="flex flex-col items-center gap-0.5">
                            <span className="text-[9px] uppercase opacity-60">
                              {d.toLocaleDateString(undefined, { weekday: "short" })}
                            </span>
                            <span className="font-medium text-[11px]">
                              {d.toLocaleDateString(undefined, { day: "2-digit" })}
                            </span>
                            {isToday && <span className="h-1 w-1 rounded-full bg-indigo-500" />}
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {currentMatrix.map((row) => (
                    <tr key={row.userId} className="group">
                      <td className="sticky left-0 z-10 whitespace-nowrap border-r border-b bg-background px-3 py-2 transition-colors group-hover:bg-muted/20">
                        <div className="flex items-center gap-2">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border bg-muted font-bold text-[9px] text-muted-foreground">
                            {userInitials(row.userName)}
                          </span>
                          <span className="font-medium text-[12px]">{row.userName}</span>
                        </div>
                      </td>
                      {days.map((d) => {
                        const ds = d.toISOString().slice(0, 10);
                        const cell = row.days[ds] ?? { hours: 0, capacity: 8, tasks: [] };
                        const pct = cell.capacity > 0 ? cell.hours / cell.capacity : 0;
                        const isSelected = selected?.userId === row.userId && selected?.date === ds;
                        const isToday = ds === TODAY_STR;
                        const theme = cellTheme(cell.hours, cell.capacity);

                        return (
                          <td
                            key={ds}
                            onClick={() => handleCellClick(row, ds, cell)}
                            onKeyDown={(e) => e.key === "Enter" && handleCellClick(row, ds, cell)}
                            tabIndex={cell.hours > 0 ? 0 : -1}
                            title={
                              cell.hours > 0
                                ? `${row.userName} · ${ds} · ${cell.hours.toFixed(1)}h / ${cell.capacity}h`
                                : undefined
                            }
                            className={cn(
                              "relative border-r border-b px-1 py-2.5 text-center transition-all",
                              cell.hours > 0 ? "cursor-pointer" : "cursor-default",
                              theme.bg,
                              theme.text,
                              isToday && "ring-1 ring-indigo-300 ring-inset dark:ring-indigo-700",
                              isSelected && "ring-2 ring-primary ring-inset",
                            )}
                          >
                            {cell.hours > 0 && (
                              <>
                                <span className="font-semibold text-[11px] tabular-nums">{cell.hours.toFixed(1)}h</span>
                                <div className="absolute inset-x-1.5 bottom-1 h-0.5 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                                  <div
                                    className="h-full rounded-full transition-all"
                                    style={{ width: `${Math.min(pct * 100, 100)}%`, backgroundColor: theme.bar }}
                                  />
                                </div>
                              </>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right panel */}
        {panelOpen && (
          <div className="flex w-full shrink-0 flex-col overflow-hidden border-t lg:w-80 lg:border-t-0 lg:border-l">
            {/* ── Conflicts panel ─────────────────────────────────────── */}
            {showConflicts && (
              <>
                <div className="flex shrink-0 items-center justify-between border-b bg-red-50/50 px-4 py-3 dark:bg-red-950/10">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />
                    <p className="font-semibold text-sm">Sovraccarichi rilevati</p>
                    <span className="rounded-full bg-red-100 px-1.5 py-0.5 font-bold text-[10px] text-red-700 dark:bg-red-900/40 dark:text-red-400">
                      {totalConflicts}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={() => setShowConflicts(false)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>

                <div className="shrink-0 border-b px-4 py-2.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full gap-1.5 text-xs"
                    disabled={resolvingAll}
                    onClick={handleResolveAll}
                  >
                    {resolvingAll ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Zap className="h-3.5 w-3.5 text-orange-500" />
                    )}
                    Posticipa tutti i sovraccarichi
                  </Button>
                  <p className="mt-1.5 text-[10px] text-muted-foreground">
                    Sposta le scadenze al minimo necessario per ≤8h/giorno
                  </p>
                </div>

                <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3">
                  {conflicts.map((conflict) => (
                    <div key={`${conflict.userId}-${conflict.date}`} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border bg-muted font-bold text-[8px] text-muted-foreground">
                            {userInitials(conflict.userName)}
                          </span>
                          <span className="font-medium text-[11px]">{conflict.userName}</span>
                          <span className="text-muted-foreground text-[11px]">·</span>
                          <span className="text-[11px] text-muted-foreground capitalize">
                            {new Date(`${conflict.date}T00:00:00`).toLocaleDateString(undefined, {
                              weekday: "short",
                              day: "2-digit",
                              month: "short",
                            })}
                          </span>
                        </div>
                        <span className="rounded-full bg-red-100 px-1.5 py-0.5 font-semibold text-[10px] text-red-700 dark:bg-red-900/40 dark:text-red-400">
                          +{(conflict.cell.hours - conflict.cell.capacity).toFixed(1)}h
                        </span>
                      </div>

                      <div className="space-y-1.5 pl-1">
                        {conflict.cell.tasks.map((task) => (
                          <TaskCard
                            key={task.id}
                            task={task}
                            cellHours={conflict.cell.hours}
                            showReschedule
                            rescheduling={reschedulingIds.has(task.id)}
                            onReschedule={handleReschedule}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* ── Cell detail panel ────────────────────────────────────── */}
            {selected && !showConflicts && (
              <>
                <div className="flex shrink-0 items-start justify-between border-b bg-muted/20 px-4 py-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border bg-muted font-bold text-[9px] text-muted-foreground">
                        {userInitials(selected.userName)}
                      </span>
                      <p className="font-semibold text-sm">{selected.userName}</p>
                    </div>
                    <p className="text-muted-foreground text-xs capitalize">
                      {new Date(`${selected.date}T00:00:00`).toLocaleDateString(undefined, {
                        weekday: "long",
                        day: "2-digit",
                        month: "long",
                      })}
                    </p>
                  </div>
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => setSelected(null)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>

                <div className="shrink-0 space-y-2 border-b px-4 py-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      {t("utilizationOf", {
                        hours: selected.cell.hours.toFixed(1),
                        capacity: selected.cell.capacity,
                      })}
                    </span>
                    <span
                      className={cn(
                        "font-semibold tabular-nums",
                        selected.cell.hours > selected.cell.capacity ? "text-destructive" : "",
                      )}
                    >
                      {Math.round((selected.cell.hours / selected.cell.capacity) * 100)}%
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all",
                        utilBarColor(selected.cell.hours / selected.cell.capacity),
                      )}
                      style={{ width: `${Math.min((selected.cell.hours / selected.cell.capacity) * 100, 100)}%` }}
                    />
                  </div>
                  {selected.cell.hours > selected.cell.capacity && (
                    <p className="flex items-center gap-1 text-[11px] text-destructive">
                      <AlertTriangle className="h-3 w-3" />
                      {t("overbookedBy", { hours: (selected.cell.hours - selected.cell.capacity).toFixed(1) })}
                    </p>
                  )}
                </div>

                <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
                  <p className="font-semibold text-[11px] text-muted-foreground uppercase tracking-wide">
                    {t("tasksThisDay")}
                  </p>
                  {selected.cell.tasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      cellHours={selected.cell.hours}
                      showReschedule={selected.cell.hours > selected.cell.capacity}
                      rescheduling={reschedulingIds.has(task.id)}
                      onReschedule={handleReschedule}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
