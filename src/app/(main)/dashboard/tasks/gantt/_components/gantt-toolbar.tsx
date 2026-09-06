"use client";

import { useState } from "react";

import Link from "next/link";

import { ArrowLeft, CalendarIcon, ChevronLeft, ChevronRight, PanelRight } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useGanttStore } from "@/stores/gantt-store";

const STATUS_COLORS = {
  done: "#10b981",
  in_progress: "#6366f1",
  todo: "#94a3b8",
} as const;

interface Props {
  viewMode: "Day" | "Week" | "Month";
  setViewMode: (mode: "Day" | "Week" | "Month") => void;
  viewDate: Date;
  setViewDate: (date: Date) => void;
  showWorkload: boolean;
  onToggleWorkload: () => void;
  conflictCount: number;
}

export function GanttToolbar({
  viewMode,
  setViewMode,
  viewDate,
  setViewDate,
  showWorkload,
  onToggleWorkload,
  conflictCount,
}: Props) {
  const t = useTranslations("tasks.gantt");
  const [popoverOpen, setPopoverOpen] = useState(false);

  const rawTasks = useGanttStore((s) => s.rawTasks);

  const done = rawTasks.filter((r) => r.status === "done").length;
  const inProg = rawTasks.filter((r) => r.status === "in_progress").length;
  const todo = rawTasks.filter((r) => r.status === "todo").length;
  const withDates = rawTasks.filter((r) => r.dueDate !== null).length;
  const total = rawTasks.length;
  const donePct = withDates > 0 ? Math.round((done / withDates) * 100) : 0;

  const stepDays = viewMode === "Day" ? 7 : viewMode === "Week" ? 28 : 90;
  const isToday = (() => {
    const n = new Date();
    return (
      n.getFullYear() === viewDate.getFullYear() &&
      n.getMonth() === viewDate.getMonth() &&
      n.getDate() === viewDate.getDate()
    );
  })();

  const handlePrev = () => setViewDate(new Date(viewDate.getTime() - stepDays * 86400000));
  const handleNext = () => setViewDate(new Date(viewDate.getTime() + stepDays * 86400000));
  const handleToday = () => setViewDate(new Date());

  return (
    <div className="flex shrink-0 flex-col gap-3 border-b px-6 py-4">
      {/* Row 1: back + title | nav + view selector */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="icon" asChild className="h-8 w-8">
            <Link href="/dashboard/tasks">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div className="flex items-center gap-2">
            <CalendarIcon className="h-5 w-5 text-muted-foreground" />
            <h1 className="font-semibold text-lg">{t("title")}</h1>
          </div>
          <span className="rounded-md bg-muted px-2 py-0.5 text-muted-foreground text-xs">
            {t("tasksWithDates", { withDates, total })}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Time navigation */}
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={handlePrev}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" className="h-8 px-3" onClick={handleToday} disabled={isToday}>
              Oggi
            </Button>
            <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="h-8 gap-1.5 px-3 font-normal text-sm">
                  <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
                  {viewDate.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  mode="single"
                  selected={viewDate}
                  onSelect={(d) => {
                    if (d) {
                      setViewDate(d);
                      setPopoverOpen(false);
                    }
                  }}
                />
              </PopoverContent>
            </Popover>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={handleNext}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {/* View mode */}
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

          {/* Workload panel toggle */}
          <div className="relative">
            <Button
              variant={showWorkload ? "secondary" : "outline"}
              size="icon"
              className="h-8 w-8"
              onClick={onToggleWorkload}
              title={t("workloadToggle")}
            >
              <PanelRight className="h-4 w-4" />
            </Button>
            {conflictCount > 0 && (
              <span className="-right-1 -top-1 absolute flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-0.5 font-bold text-[9px] text-white">
                {conflictCount > 99 ? "99+" : conflictCount}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Row 2: legend + progress bar */}
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
            <span className="select-none text-border">|</span>
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
  );
}
