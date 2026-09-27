"use client";

import { useEffect, useRef, useState } from "react";

import Link from "next/link";

import {
  AlertTriangle,
  ArrowRight,
  CalendarCheck,
  CalendarDays,
  CheckCircle2,
  CheckSquare,
  PhoneCall,
  Square,
  Users,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { TaskOutcomeDialog } from "@/components/crm/task-outcome-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AgendaItem = {
  id: string;
  kind: "task" | "meeting" | "call" | "appointment";
  /** A task's own kind (call, email, meeting, todo) — what "done" asks about. */
  taskType?: string;
  title: string;
  timeISO: string | null;
  endTimeISO: string | null;
  allDay: boolean;
  priority: string;
  status: string;
  entityName: string | null;
  entityHref: string | null;
  taskHref: string | null;
  durationMinutes: number | null;
  estimatedHours: string | null;
  isOverdue: boolean;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const HOUR_START = 7;
const HOUR_END = 22;
const HOUR_HEIGHT = 64; // px per hour
const TOTAL_HEIGHT = (HOUR_END - HOUR_START) * HOUR_HEIGHT;
const HOURS = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i);

const KIND_STYLE = {
  task: {
    border: "border-l-blue-400",
    pill: "bg-blue-100 text-blue-800 dark:bg-blue-950/70 dark:text-blue-200",
    dot: "bg-blue-500",
    icon: CheckSquare,
    labelKey: "typeTask",
  },
  meeting: {
    border: "border-l-violet-400",
    pill: "bg-violet-100 text-violet-800 dark:bg-violet-950/70 dark:text-violet-200",
    dot: "bg-violet-500",
    icon: Users,
    labelKey: "typeMeeting",
  },
  call: {
    border: "border-l-emerald-400",
    pill: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-200",
    dot: "bg-emerald-500",
    icon: PhoneCall,
    labelKey: "typeCall",
  },
  appointment: {
    border: "border-l-amber-400",
    pill: "bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-200",
    dot: "bg-amber-500",
    icon: CalendarCheck,
    labelKey: "typeAppointment",
  },
} satisfies Record<
  AgendaItem["kind"],
  // labelKey is a message key under `calendar`.
  { border: string; pill: string; dot: string; icon: React.ElementType; labelKey: string }
>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toMin(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

function fmtTime(iso: string, locale: string): string {
  return new Date(iso).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}

function fmtOverdueLabel(iso: string | null, t: (key: string, values?: { days: number }) => string): string {
  if (!iso) return t("overdue");
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days === 0) return t("overdueToday");
  if (days === 1) return t("yesterday");
  return t("daysAgo", { days });
}

// ─── Task row (all-day section) ───────────────────────────────────────────────

function TaskRow({ item, isDone, onDone }: { item: AgendaItem; isDone: boolean; onDone: (id: string) => void }) {
  const t = useTranslations("crm.agendaWidget");
  const tTasks = useTranslations("tasks");
  return (
    <div
      className={`group flex items-center gap-2.5 rounded-lg border-l-[3px] px-3 py-2 transition-colors hover:bg-muted/50 ${
        item.isOverdue ? "border-l-red-400 bg-red-50/40 dark:bg-red-950/10" : "border-l-blue-400"
      } ${isDone ? "opacity-40" : ""}`}
    >
      <button
        type="button"
        onClick={() => !isDone && onDone(item.id)}
        // The padding is the finger's target, the negative margin keeps the row where it was.
        className="-m-2.5 shrink-0 p-2.5 text-muted-foreground transition-colors hover:text-emerald-500"
        title={tTasks("markComplete")}
      >
        {isDone ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Square className="h-4 w-4" />}
      </button>

      <div className="min-w-0 flex-1">
        <div
          className={`truncate font-medium text-sm leading-snug ${isDone ? "text-muted-foreground line-through" : ""} ${item.isOverdue && !isDone ? "text-red-700 dark:text-red-400" : ""}`}
        >
          {item.title}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
          {item.isOverdue && !isDone && (
            <span className="flex items-center gap-0.5 font-medium text-red-500 text-xs">
              <AlertTriangle className="h-3 w-3" />
              {fmtOverdueLabel(item.timeISO, t)}
            </span>
          )}
          {item.entityName && <span className="truncate text-muted-foreground text-xs">{item.entityName}</span>}
          {item.priority !== "normal" && item.priority !== "low" && (
            <span
              className={`font-medium text-xs ${item.priority === "urgent" || item.priority === "critical" ? "text-red-500" : "text-orange-500"}`}
            >
              {item.priority === "urgent"
                ? t("urgent")
                : item.priority === "critical"
                  ? tTasks("priorities.critical")
                  : tTasks("priorities.high")}
            </span>
          )}
          {item.estimatedHours && (
            <span className="text-muted-foreground text-xs">{t("estimatedHours", { hours: item.estimatedHours })}</span>
          )}
        </div>
      </div>

      {item.taskHref && (
        <Link
          href={item.taskHref}
          className="-m-2 mt-0.5 shrink-0 p-2 opacity-0 transition-opacity group-hover:opacity-100"
          title={t("openDetail")}
          aria-label={t("openDetail")}
        >
          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
        </Link>
      )}
    </div>
  );
}

// ─── Layout computation ───────────────────────────────────────────────────────

type LayoutEvent = AgendaItem & { col: number; numCols: number; startMin: number; endMin: number };

function layoutTimedItems(items: AgendaItem[]): LayoutEvent[] {
  const mapped: LayoutEvent[] = items
    .filter((i) => i.timeISO)
    .map((i) => {
      const startMin = toMin(i.timeISO!);
      const endMin = i.endTimeISO
        ? toMin(i.endTimeISO)
        : i.durationMinutes
          ? startMin + i.durationMinutes
          : startMin + 60;
      return { ...i, startMin, endMin: Math.max(endMin, startMin + 30), col: 0, numCols: 1 };
    })
    .sort((a, b) => a.startMin - b.startMin);

  // Greedy column assignment
  const colEnds: number[] = [];
  for (const ev of mapped) {
    let placed = false;
    for (let c = 0; c < colEnds.length; c++) {
      if (colEnds[c] <= ev.startMin) {
        ev.col = c;
        colEnds[c] = ev.endMin;
        placed = true;
        break;
      }
    }
    if (!placed) {
      ev.col = colEnds.length;
      colEnds.push(ev.endMin);
    }
  }

  // numCols = max concurrent columns in the same overlap cluster
  for (const ev of mapped) {
    const overlapping = mapped.filter((o) => o.startMin < ev.endMin && o.endMin > ev.startMin);
    ev.numCols = Math.max(...overlapping.map((o) => o.col + 1));
  }

  return mapped;
}

// ─── Phone list ───────────────────────────────────────────────────────────────

/**
 * The timed part of the agenda as a chronological list, below `sm`.
 *
 * Same items, same links, same order as the grid; what is lost is only the
 * picture of free time between them, which a phone has no room to draw.
 */
function PhoneAgenda({ events, empty, nowMin }: { events: LayoutEvent[]; empty: boolean; nowMin: number }) {
  const t = useTranslations("crm.agendaWidget");
  const locale = useLocale();

  if (empty) {
    return (
      <div className="flex items-center gap-2 rounded-lg border px-3 py-4 text-muted-foreground text-xs sm:hidden">
        <CalendarDays className="h-4 w-4 opacity-40" />
        {t("noTimedItems")}
      </div>
    );
  }

  return (
    <ul className="space-y-1.5 sm:hidden">
      {events.map((ev) => {
        const style = KIND_STYLE[ev.kind];
        const Icon = style.icon;
        const past = ev.endMin <= nowMin;
        return (
          <li key={ev.id}>
            <Link
              href={ev.taskHref ?? ev.entityHref ?? "#"}
              className={`flex min-h-11 items-stretch gap-3 rounded-lg border-l-[3px] px-3 py-2 transition-opacity hover:opacity-80 ${style.pill} ${style.border} ${past ? "opacity-60" : ""}`}
            >
              <span className="min-w-11 shrink-0 whitespace-nowrap pt-px font-semibold text-xs tabular-nums">
                {ev.timeISO ? fmtTime(ev.timeISO, locale) : ""}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1 font-semibold text-sm leading-tight">
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{ev.title}</span>
                </span>
                {(ev.endTimeISO || ev.entityName) && (
                  <span className="mt-0.5 block truncate text-xs opacity-75">
                    {ev.endTimeISO && `– ${fmtTime(ev.endTimeISO, locale)}`}
                    {ev.endTimeISO && ev.entityName && " · "}
                    {ev.entityName}
                  </span>
                )}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

// ─── Widget ───────────────────────────────────────────────────────────────────

export function AgendaWidget({ items, dateLabel }: { items: AgendaItem[]; dateLabel: string }) {
  const t = useTranslations("crm.agendaWidget");
  const tCal = useTranslations("calendar");
  const locale = useLocale();
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const scrollRef = useRef<HTMLDivElement>(null);

  // Tick every minute for the current-time indicator
  useEffect(() => {
    const id = setInterval(() => setCurrentTime(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Auto-scroll to current time on mount
  useEffect(() => {
    if (!scrollRef.current) return;
    const now = new Date();
    const minutesFromStart = (now.getHours() - HOUR_START) * 60 + now.getMinutes();
    const scrollTop = (minutesFromStart / 60) * HOUR_HEIGHT - 120;
    scrollRef.current.scrollTop = Math.max(0, scrollTop);
  }, []);

  // Completing asks "how did it go?" — the outcome, a note and the next step in one panel.
  const [asking, setAsking] = useState<AgendaItem | null>(null);
  const handleDone = (id: string) => {
    const item = items.find((i) => i.id === id);
    if (item) setAsking(item);
  };

  const taskItems = items.filter((i) => i.kind === "task" && i.allDay);
  const timedItems = items.filter((i) => i.kind !== "task" || !i.allDay);
  const layoutEvents = layoutTimedItems(timedItems);

  const activeTaskCount = taskItems.filter((i) => !doneIds.has(i.id)).length;
  const totalCount = activeTaskCount + timedItems.length;

  // Current time indicator position
  const nowMin = currentTime.getHours() * 60 + currentTime.getMinutes();
  const nowTop = ((nowMin - HOUR_START * 60) / 60) * HOUR_HEIGHT;
  const showNowLine = nowMin >= HOUR_START * 60 && nowMin <= HOUR_END * 60;

  return (
    <Card className="flex flex-col shadow-sm">
      <CardHeader className="shrink-0 pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <CalendarDays className="h-5 w-5 shrink-0 text-primary" />
            <div className="min-w-0">
              <CardTitle className="text-base leading-none">{t("title")}</CardTitle>
              <p className="mt-1 text-muted-foreground text-xs capitalize">{dateLabel}</p>
            </div>
            {totalCount > 0 && (
              <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 font-semibold text-primary text-xs">
                {totalCount}
              </span>
            )}
          </div>
          <Button variant="outline" size="sm" className="h-8 shrink-0 gap-1.5 max-sm:size-9 max-sm:p-0" asChild>
            <Link href="/dashboard/calendar" aria-label={tCal("title")}>
              <CalendarDays className="h-3.5 w-3.5" /> <span className="max-sm:sr-only">{tCal("title")}</span>
            </Link>
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col px-4 pb-4">
        {items.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-center">
            <CheckCircle2 className="mb-3 h-10 w-10 text-emerald-400/50" />
            <p className="font-medium text-muted-foreground text-sm">{t("emptyTitle")}</p>
            <p className="mt-1 text-muted-foreground/60 text-xs">{t("emptyHint")}</p>
            <Button variant="outline" size="sm" className="mt-4 h-8 gap-1.5" asChild>
              <Link href="/dashboard/tasks">
                <CheckSquare className="h-3.5 w-3.5" /> {t("viewAllTasks")}
              </Link>
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {/* All-day tasks */}
            {taskItems.length > 0 && (
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 px-1">
                  <CheckSquare className="h-3 w-3 text-blue-500" />
                  <span className="font-semibold text-[11px] text-blue-600 uppercase tracking-wider dark:text-blue-400">
                    {tCal("tasks")}
                  </span>
                  <span className="text-[11px] text-muted-foreground/60">({taskItems.length})</span>
                </div>
                {taskItems.map((item) => (
                  <TaskRow key={item.id} item={item} isDone={doneIds.has(item.id)} onDone={handleDone} />
                ))}
              </div>
            )}

            {/* Time grid */}
            <div>
              {taskItems.length > 0 && timedItems.length > 0 && (
                <div className="flex items-center gap-1.5 px-1 pb-1">
                  <CalendarDays className="h-3 w-3 text-muted-foreground" />
                  <span className="font-semibold text-[11px] text-muted-foreground uppercase tracking-wider">
                    {t("schedule")}
                  </span>
                </div>
              )}

              <PhoneAgenda events={layoutEvents} empty={timedItems.length === 0} nowMin={nowMin} />

              {/*
                The time grid from `sm` up. On a phone the events column is ~250px
                wide, two overlapping meetings get 125px each and their titles are
                cut to a word; and the grid is 900px of mostly empty hours inside
                a page that already scrolls. The list above says the same thing.
              */}
              <div
                ref={scrollRef}
                className="relative hidden overflow-y-auto rounded-lg border sm:flex"
                style={{ maxHeight: "560px" }}
              >
                {/* Time labels */}
                <div
                  className="relative w-12 shrink-0 select-none border-r bg-muted/20"
                  style={{ height: `${TOTAL_HEIGHT}px` }}
                >
                  {HOURS.map((h) => (
                    <div
                      key={h}
                      className="absolute right-0 flex items-start justify-end pr-2"
                      style={{ top: `${(h - HOUR_START) * HOUR_HEIGHT - 8}px` }}
                    >
                      <span className="font-medium text-[10px] text-muted-foreground/60 tabular-nums">
                        {`${h.toString().padStart(2, "0")}:00`}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Events area */}
                <div className="relative flex-1" style={{ height: `${TOTAL_HEIGHT}px` }}>
                  {/* Hour lines */}
                  {HOURS.map((h) => (
                    <div
                      key={h}
                      className="absolute right-0 left-0 border-muted/50 border-t"
                      style={{ top: `${(h - HOUR_START) * HOUR_HEIGHT}px` }}
                    />
                  ))}
                  {/* Half-hour lines */}
                  {HOURS.slice(0, -1).map((h) => (
                    <div
                      key={`${h}-half`}
                      className="absolute right-0 left-0 border-muted/25 border-t border-dashed"
                      style={{ top: `${(h - HOUR_START) * HOUR_HEIGHT + HOUR_HEIGHT / 2}px` }}
                    />
                  ))}

                  {/* Current time indicator */}
                  {showNowLine && (
                    <div
                      className="pointer-events-none absolute right-0 left-0 z-10 flex items-center"
                      style={{ top: `${nowTop}px` }}
                    >
                      <div className="-ml-1 h-2 w-2 rounded-full bg-red-500" />
                      <div className="flex-1 border-red-500 border-t" />
                    </div>
                  )}

                  {/* Empty state for timed items */}
                  {timedItems.length === 0 && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-muted-foreground">
                      <CalendarDays className="h-8 w-8 opacity-15" />
                      <p className="text-xs">{t("noTimedItems")}</p>
                    </div>
                  )}

                  {/* Event blocks */}
                  {layoutEvents.map((ev) => {
                    const clampedStart = Math.max(ev.startMin, HOUR_START * 60);
                    const clampedEnd = Math.min(ev.endMin, HOUR_END * 60);
                    if (clampedEnd <= clampedStart) return null;

                    const top = ((clampedStart - HOUR_START * 60) / 60) * HOUR_HEIGHT;
                    const height = Math.max(((clampedEnd - clampedStart) / 60) * HOUR_HEIGHT, 28);
                    const leftPct = (ev.col / ev.numCols) * 100;
                    const widthPct = 100 / ev.numCols;

                    const style = KIND_STYLE[ev.kind];
                    const Icon = style.icon;

                    return (
                      <Link
                        key={ev.id}
                        href={ev.taskHref ?? ev.entityHref ?? "#"}
                        className="absolute px-1 py-0.5"
                        style={{
                          top: `${top}px`,
                          height: `${height}px`,
                          left: `${leftPct}%`,
                          width: `${widthPct}%`,
                        }}
                      >
                        <div
                          className={`flex h-full flex-col overflow-hidden rounded-[3px] border-l-[3px] px-2 py-1 transition-opacity hover:opacity-80 ${style.pill} ${style.border}`}
                        >
                          <div className="flex items-center gap-1 font-semibold text-xs leading-tight">
                            <Icon className="h-3 w-3 shrink-0" />
                            <span className="truncate">{ev.title}</span>
                          </div>
                          {height >= 44 && ev.timeISO && (
                            <div className="mt-0.5 truncate text-[10px] leading-tight opacity-75">
                              {fmtTime(ev.timeISO, locale)}
                              {ev.endTimeISO && ` – ${fmtTime(ev.endTimeISO, locale)}`}
                            </div>
                          )}
                          {height >= 60 && ev.entityName && (
                            <div className="mt-0.5 truncate text-[10px] leading-tight opacity-65">{ev.entityName}</div>
                          )}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
      {asking && (
        <TaskOutcomeDialog
          task={{ id: asking.id, title: asking.title, type: asking.taskType }}
          open
          onOpenChange={(v) => {
            if (!v) setAsking(null);
          }}
          revalidate="/dashboard/crm"
          onCompleted={() => setDoneIds((prev) => new Set([...prev, asking.id]))}
        />
      )}
    </Card>
  );
}
