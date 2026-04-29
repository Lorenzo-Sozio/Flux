import Link from "next/link";

import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  isBefore,
  isSameDay,
  isSameMonth,
  isSameWeek,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
  subWeeks,
} from "date-fns";
import {
  CalendarCheck,
  CalendarDays,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Columns3,
  LayoutGrid,
  List,
  PhoneCall,
  Users,
} from "lucide-react";
import { getTranslations } from "next-intl/server";

import { type CalendarFilter, getCalendarEvents } from "@/actions/calendar";
import { CalendarOverdueSection } from "@/components/crm/calendar-overdue-section";
import { CalendarTaskPill } from "@/components/crm/calendar-task-pill";
import { FormattedTime } from "@/components/crm/formatted-time";
import { OverdueTasksPopover } from "@/components/crm/overdue-tasks-popover";
import { WeekCurrentTimeLine } from "@/components/crm/week-current-time-line";
import { Button } from "@/components/ui/button";

import { AppointmentDetailSheet } from "./_components/appointment-detail-sheet";
import { AppointmentDialog } from "./_components/appointment-dialog";

// ─── URL helper ──────────────────────────────────────────────────────────────

function calUrl(view: string, date: string, filter: string) {
  const p = new URLSearchParams({ view, date });
  if (filter !== "all") p.set("filter", filter);
  return `/dashboard/calendar?${p}`;
}

// ─── Event type helpers ───────────────────────────────────────────────────────

type CalendarEvent = Awaited<ReturnType<typeof getCalendarEvents>>[number];

const TYPE_STYLES = {
  task: {
    pill: "bg-blue-100 dark:bg-blue-950/70 text-blue-800 dark:text-blue-200 border-l-blue-500",
    dot: "bg-blue-500",
    icon: CheckSquare,
  },
  meeting: {
    pill: "bg-violet-100 dark:bg-violet-950/70 text-violet-800 dark:text-violet-200 border-l-violet-500",
    dot: "bg-violet-500",
    icon: Users,
  },
  call: {
    pill: "bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-200 border-l-emerald-500",
    dot: "bg-emerald-500",
    icon: PhoneCall,
  },
  appointment: {
    pill: "bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-200 border-l-amber-500",
    dot: "bg-amber-500",
    icon: CalendarCheck,
  },
} as const;

function getTypeStyle(type: string) {
  return TYPE_STYLES[type as keyof typeof TYPE_STYLES] ?? TYPE_STYLES.task;
}

// Non-task events (meetings/calls) — static server component pill
function EventPill({ event, compact = false }: { event: CalendarEvent; compact?: boolean }) {
  const ts = getTypeStyle(event.type);
  const Icon = ts.icon;
  return (
    <Link href={event.link} title={`${event.displayTitle} — ${event.entityName}`}>
      <div
        className={`flex items-center gap-1.5 rounded border-l-[3px] px-1.5 py-1 text-xs leading-tight transition-opacity hover:opacity-80 ${ts.pill}`}
      >
        <Icon className="h-3 w-3 shrink-0" />
        {!compact && event.date && (
          <span className="shrink-0 font-semibold tabular-nums opacity-70">
            <FormattedTime date={event.date} />
          </span>
        )}
        <span className="truncate font-medium">{event.displayTitle}</span>
      </div>
    </Link>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; date?: string; appointment?: string; filter?: string }>;
}) {
  const [{ view: viewParam, date: dateParam, appointment: appointmentId, filter: filterParam }, t] = await Promise.all([
    searchParams,
    getTranslations("calendar"),
  ]);

  const currentView = viewParam ?? "week";
  const currentFilter = (filterParam ?? "all") as CalendarFilter;
  const baseDate = dateParam ? new Date(dateParam) : new Date();
  const today = new Date();

  // ── Compute visible range + overdue window ───────────────────────────────────
  const monthStart = startOfMonth(baseDate);
  const weekStart = startOfWeek(baseDate, { weekStartsOn: 1 });
  const visibleStart =
    currentView === "month"
      ? startOfWeek(monthStart, { weekStartsOn: 1 })
      : currentView === "week"
        ? weekStart
        : startOfDay(baseDate);
  const visibleEnd =
    currentView === "month"
      ? endOfWeek(endOfMonth(baseDate), { weekStartsOn: 1 })
      : currentView === "week"
        ? endOfWeek(baseDate, { weekStartsOn: 1 })
        : endOfDay(baseDate);
  // Always extend backwards to cover the 30-day overdue window
  const thirtyDaysAgo = startOfDay(subDays(today, 30));
  const rangeStart = visibleStart < thirtyDaysAgo ? visibleStart : thirtyDaysAgo;

  const events = await getCalendarEvents(currentFilter, { start: rangeStart, end: visibleEnd });

  // ── Quick stats ──────────────────────────────────────────────────────────────
  const todayEvents = events.filter((e) => e.date && isSameDay(new Date(e.date), today));
  const weekEvents = events.filter((e) => e.date && isSameWeek(new Date(e.date), today, { weekStartsOn: 1 }));
  const overdueEvents = events.filter(
    (e) =>
      e.date &&
      isBefore(new Date(e.date), startOfDay(today)) &&
      !isBefore(new Date(e.date), thirtyDaysAgo) &&
      e.type === "task" &&
      (e as any).status !== "done",
  );

  // ── Navigation URLs ──────────────────────────────────────────────────────────
  const todayUrl = calUrl(currentView, format(today, "yyyy-MM-dd"), currentFilter);
  const prevUrl =
    currentView === "week"
      ? calUrl("week", format(subWeeks(baseDate, 1), "yyyy-MM-dd"), currentFilter)
      : calUrl("month", format(subMonths(baseDate, 1), "yyyy-MM-dd"), currentFilter);
  const nextUrl =
    currentView === "week"
      ? calUrl("week", format(addWeeks(baseDate, 1), "yyyy-MM-dd"), currentFilter)
      : calUrl("month", format(addMonths(baseDate, 1), "yyyy-MM-dd"), currentFilter);

  const periodTitle =
    currentView === "week"
      ? `${format(weekStart, "MMM d")} – ${format(endOfWeek(baseDate, { weekStartsOn: 1 }), "MMM d, yyyy")}`
      : format(monthStart, "MMMM yyyy");

  // ── VIEW: Month ──────────────────────────────────────────────────────────────
  const renderMonth = () => {
    const startDate = startOfWeek(startOfMonth(baseDate), { weekStartsOn: 1 });
    const endDate = endOfWeek(endOfMonth(baseDate), { weekStartsOn: 1 });
    const calDays = eachDayOfInterval({ start: startDate, end: endDate });
    const DAYS = [
      t("days.mon"),
      t("days.tue"),
      t("days.wed"),
      t("days.thu"),
      t("days.fri"),
      t("days.sat"),
      t("days.sun"),
    ];
    const MAX_VISIBLE = 4;

    return (
      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        {/* Day headers */}
        <div className="grid grid-cols-7 border-b bg-muted/40">
          {DAYS.map((d, i) => (
            <div
              key={d}
              className={`py-3 text-center font-semibold text-xs uppercase tracking-wider ${
                i >= 5 ? "text-muted-foreground/50" : "text-muted-foreground"
              }`}
            >
              {d}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7 divide-x divide-y">
          {calDays.map((day, idx) => {
            const dayEvents = events
              .filter((e) => e.date && isSameDay(new Date(e.date), day))
              .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
            const inMonth = isSameMonth(day, baseDate);
            const isToday = isSameDay(day, today);
            const isWeekend = idx % 7 >= 5;
            const overflow = dayEvents.length - MAX_VISIBLE;
            const agendaUrl = calUrl("agenda", format(day, "yyyy-MM-dd"), currentFilter);

            return (
              <div
                key={day.toISOString()}
                className={`flex min-h-[160px] flex-col gap-1 p-2 transition-colors ${
                  isToday
                    ? "bg-primary/[0.04] dark:bg-primary/[0.06]"
                    : !inMonth
                      ? "bg-muted/30 dark:bg-muted/10"
                      : isWeekend
                        ? "bg-muted/10"
                        : "bg-background"
                }`}
              >
                {/* Date number */}
                <div className="mb-0.5 flex items-center justify-end">
                  {isToday ? (
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary font-bold text-primary-foreground text-xs">
                      {format(day, "d")}
                    </span>
                  ) : (
                    <span
                      className={`font-semibold text-xs ${!inMonth ? "text-muted-foreground/40" : isWeekend ? "text-muted-foreground/60" : "text-muted-foreground"}`}
                    >
                      {format(day, "d")}
                    </span>
                  )}
                </div>

                {/* Events — task events get quick-complete pill */}
                {dayEvents
                  .slice(0, MAX_VISIBLE)
                  .map((ev) =>
                    ev.type === "task" ? (
                      <CalendarTaskPill key={ev.id} event={ev} compact />
                    ) : (
                      <EventPill key={ev.id} event={ev} compact />
                    ),
                  )}
                {overflow > 0 && (
                  <Link
                    href={agendaUrl}
                    className="mt-auto py-0.5 text-center font-medium text-[11px] text-muted-foreground leading-none hover:text-primary"
                  >
                    {t("more", { count: overflow })}
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // ── VIEW: Week (time-grid) ───────────────────────────────────────────────────
  const renderWeek = () => {
    const HOUR_START = 7;
    const HOUR_END = 22;
    const HOUR_HEIGHT = 56;
    const HOURS = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i);
    const TOTAL_HEIGHT = (HOUR_END - HOUR_START) * HOUR_HEIGHT;

    const weekDays = eachDayOfInterval({
      start: weekStart,
      end: endOfWeek(baseDate, { weekStartsOn: 1 }),
    });

    const DAY_KEYS: Record<number, string> = {
      1: t("days.mon"),
      2: t("days.tue"),
      3: t("days.wed"),
      4: t("days.thu"),
      5: t("days.fri"),
      6: t("days.sat"),
      0: t("days.sun"),
    };

    type LayoutEvent = {
      event: CalendarEvent;
      startMin: number;
      endMin: number;
      col: number;
      numCols: number;
    };

    // All-day tasks per day
    const allDayByDay = weekDays.map((d) =>
      events.filter(
        (e) => e.date && isSameDay(new Date(e.date), d) && e.type === "task" && (e as any).allDay !== false,
      ),
    );
    const hasAnyAllDay = allDayByDay.some((arr) => arr.length > 0);

    // Timed events per day with column layout
    const layoutByDay: LayoutEvent[][] = weekDays.map((d) => {
      const dayTimed = events.filter(
        (e) => e.date && isSameDay(new Date(e.date), d) && (e.type !== "task" || (e as any).allDay === false),
      );

      const laid: LayoutEvent[] = dayTimed
        .map((ev) => {
          const start = new Date(ev.date);
          const startMin = start.getHours() * 60 + start.getMinutes();
          const endAtRaw = (ev as any).endAt;
          const endMin = endAtRaw
            ? (() => {
                const e = new Date(endAtRaw);
                return e.getHours() * 60 + e.getMinutes();
              })()
            : startMin + 60;
          return { event: ev, startMin, endMin: Math.max(endMin, startMin + 30), col: 0, numCols: 1 };
        })
        .sort((a, b) => a.startMin - b.startMin);

      const colEnds: number[] = [];
      for (const ev of laid) {
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

      for (const ev of laid) {
        const overlapping = laid.filter((o) => o.startMin < ev.endMin && o.endMin > ev.startMin);
        ev.numCols = Math.max(...overlapping.map((o) => o.col + 1));
      }

      return laid;
    });

    const gridCols = "48px repeat(7, minmax(0, 1fr))";

    return (
      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        {/* Single scroll container — headers, all-day strip, and time grid all share identical width */}
        <div className="overflow-y-auto" style={{ maxHeight: "calc(100vh - 280px)", minHeight: "480px", scrollbarGutter: "stable" }}>
          {/* Sticky wrapper: day headers + all-day strip pinned together at top */}
          <div className="sticky top-0 z-20">
            {/* Day headers */}
            <div className="border-b bg-muted/40" style={{ display: "grid", gridTemplateColumns: gridCols }}>
              <div className="border-r" />
              {weekDays.map((day) => {
                const isToday = isSameDay(day, today);
                return (
                  <div
                    key={day.toISOString()}
                    className={`border-r py-3 text-center last:border-r-0 ${isToday ? "bg-primary/5" : ""}`}
                  >
                    <div className="font-semibold text-[11px] text-muted-foreground uppercase tracking-wider">
                      {DAY_KEYS[day.getDay()]}
                    </div>
                    <div className={`mt-1 font-bold text-2xl tabular-nums ${isToday ? "text-primary" : ""}`}>
                      {format(day, "d")}
                    </div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground/60">{format(day, "MMM")}</div>
                  </div>
                );
              })}
            </div>

            {/* All-day strip */}
            <div
              className={`border-b ${hasAnyAllDay ? "bg-blue-50 dark:bg-blue-950/30" : "bg-muted/20"}`}
              style={{ display: "grid", gridTemplateColumns: gridCols }}
            >
              <div className="flex items-center justify-center overflow-hidden border-r py-2">
                <span
                  className="font-medium text-[10px] text-muted-foreground/60 uppercase tracking-wider whitespace-nowrap"
                  style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
                >
                  {t("allDay")}
                </span>
              </div>
              {weekDays.map((day, idx) => {
                const isToday = isSameDay(day, today);
                return (
                  <div
                    key={day.toISOString()}
                    className={`border-r p-1.5 last:border-r-0 ${isToday ? "bg-primary/[0.02]" : ""}`}
                    style={{ minHeight: "36px" }}
                  >
                    {allDayByDay[idx].length > 0 && (
                      <div className="flex flex-col gap-0.5">
                        {allDayByDay[idx].map((ev) => (
                          <CalendarTaskPill key={ev.id} event={ev} compact />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>{/* end sticky wrapper */}

          <div style={{ display: "grid", gridTemplateColumns: gridCols, height: `${TOTAL_HEIGHT}px` }}>
            {/* Time labels column */}
            <div className="relative select-none border-r">
              {HOURS.map((h) => (
                <div
                  key={h}
                  className="absolute right-0 flex items-start justify-end pr-2"
                  style={{ top: `${Math.max(2, (h - HOUR_START) * HOUR_HEIGHT - 8)}px` }}
                >
                  <span className="font-medium text-[10px] text-muted-foreground/70 tabular-nums">
                    {`${h.toString().padStart(2, "0")}:00`}
                  </span>
                </div>
              ))}
            </div>

            {/* Day columns */}
            {weekDays.map((day, dayIdx) => {
              const isToday = isSameDay(day, today);
              const dayLayout = layoutByDay[dayIdx];
              return (
                <div
                  key={day.toISOString()}
                  className={`relative border-r last:border-r-0 ${isToday ? "bg-primary/[0.02]" : ""}`}
                >
                  {/* Hour lines */}
                  {HOURS.map((h) => (
                    <div
                      key={h}
                      className="absolute right-0 left-0 border-muted/60 border-t"
                      style={{ top: `${(h - HOUR_START) * HOUR_HEIGHT}px` }}
                    />
                  ))}
                  {/* Half-hour lines */}
                  {HOURS.slice(0, -1).map((h) => (
                    <div
                      key={`${h}-half`}
                      className="absolute right-0 left-0 border-muted/30 border-t border-dashed"
                      style={{ top: `${(h - HOUR_START) * HOUR_HEIGHT + HOUR_HEIGHT / 2}px` }}
                    />
                  ))}
                  {/* Current time indicator (today only) */}
                  {isToday && <WeekCurrentTimeLine hourStart={HOUR_START} hourHeight={HOUR_HEIGHT} />}
                  {/* Event blocks */}
                  {dayLayout.map(({ event: ev, startMin, endMin, col, numCols }) => {
                    const clampedStart = Math.max(startMin, HOUR_START * 60);
                    const clampedEnd = Math.min(endMin, HOUR_END * 60);
                    if (clampedEnd <= clampedStart) return null;

                    const top = ((clampedStart - HOUR_START * 60) / 60) * HOUR_HEIGHT;
                    const height = Math.max(((clampedEnd - clampedStart) / 60) * HOUR_HEIGHT, 20);
                    const leftPct = (col / numCols) * 100;
                    const widthPct = 100 / numCols;
                    const ts = getTypeStyle(ev.type);
                    const Icon = ts.icon;
                    const endAtRaw = (ev as any).endAt;

                    return (
                      <Link
                        key={ev.id}
                        href={ev.link}
                        className="absolute px-0.5 py-0.5"
                        style={{
                          top: `${top}px`,
                          height: `${height}px`,
                          left: `${leftPct}%`,
                          width: `${widthPct}%`,
                        }}
                      >
                        <div
                          className={`flex h-full flex-col overflow-hidden rounded-[3px] border-l-2 px-1 py-0.5 text-xs transition-opacity hover:opacity-80 ${ts.pill}`}
                        >
                          <div className="flex items-center gap-0.5 font-semibold leading-tight">
                            <Icon className="h-2.5 w-2.5 shrink-0" />
                            <span className="truncate text-[11px]">{ev.displayTitle}</span>
                          </div>
                          {height >= 36 && (
                            <div className="truncate text-[10px] leading-tight opacity-70">
                              {format(new Date(ev.date), "HH:mm")}
                              {endAtRaw && ` – ${format(new Date(endAtRaw), "HH:mm")}`}
                            </div>
                          )}
                          {height >= 52 && ev.entityName && ev.entityName !== "No Entity" && (
                            <div className="truncate text-[10px] leading-tight opacity-60">{ev.entityName}</div>
                          )}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  // ── VIEW: Agenda (Day Timeline) ──────────────────────────────────────────────
  const renderAgenda = () => {
    const HOUR_START = 7;
    const HOUR_END = 22;
    const HOUR_HEIGHT = 64; // px per hour
    const HOURS = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i);
    const TOTAL_HEIGHT = (HOUR_END - HOUR_START) * HOUR_HEIGHT;

    const dayEvents = events.filter((e) => e.date && isSameDay(new Date(e.date), baseDate));
    const allDayEvents = dayEvents.filter((e) => e.type === "task" && (e as any).allDay !== false);
    const timedEvents = dayEvents.filter((e) => e.type !== "task" || (e as any).allDay === false);

    type LayoutEvent = {
      event: CalendarEvent;
      startMin: number;
      endMin: number;
      col: number;
      numCols: number;
    };

    const layoutEvents: LayoutEvent[] = timedEvents
      .map((ev) => {
        const start = new Date(ev.date);
        const startMin = start.getHours() * 60 + start.getMinutes();
        const endAtRaw = (ev as any).endAt;
        const endMin = endAtRaw
          ? (() => {
              const e = new Date(endAtRaw);
              return e.getHours() * 60 + e.getMinutes();
            })()
          : startMin + 60;
        return { event: ev, startMin, endMin: Math.max(endMin, startMin + 30), col: 0, numCols: 1 };
      })
      .sort((a, b) => a.startMin - b.startMin);

    // Greedy column assignment
    const colEnds: number[] = [];
    for (const ev of layoutEvents) {
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
    for (const ev of layoutEvents) {
      const overlapping = layoutEvents.filter((o) => o.startMin < ev.endMin && o.endMin > ev.startMin);
      ev.numCols = Math.max(...overlapping.map((o) => o.col + 1));
    }

    const prevAgendaUrl = calUrl("agenda", format(subDays(baseDate, 1), "yyyy-MM-dd"), currentFilter);
    const nextAgendaUrl = calUrl("agenda", format(addDays(baseDate, 1), "yyyy-MM-dd"), currentFilter);
    const isAgendaToday = isSameDay(baseDate, today);

    return (
      <div className="space-y-2">
        {/* Overdue section */}
        {overdueEvents.length > 0 && <CalendarOverdueSection tasks={overdueEvents} />}

        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
          {/* Day header with navigation */}
          <div
            className={`flex items-center justify-between border-b px-4 py-3 ${isAgendaToday ? "bg-primary/5" : "bg-muted/30"}`}
          >
            <div className="flex items-center gap-3">
              <div className={`font-black text-3xl tabular-nums leading-none ${isAgendaToday ? "text-primary" : ""}`}>
                {format(baseDate, "d")}
              </div>
              <div>
                <div className={`font-semibold text-base ${isAgendaToday ? "text-primary" : ""}`}>
                  {isAgendaToday ? t("today") : format(baseDate, "EEEE")}
                </div>
                <div className="text-muted-foreground text-xs">{format(baseDate, "MMMM yyyy")}</div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Link
                href={prevAgendaUrl}
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-all hover:bg-muted hover:text-foreground"
              >
                <ChevronLeft className="h-4 w-4" />
              </Link>
              <Button variant="outline" size="sm" asChild>
                <Link href={todayUrl}>{t("today")}</Link>
              </Button>
              <Link
                href={nextAgendaUrl}
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-all hover:bg-muted hover:text-foreground"
              >
                <ChevronRight className="h-4 w-4" />
              </Link>
            </div>
          </div>

          {/* All-day tasks strip */}
          {allDayEvents.length > 0 && (
            <div className="flex items-start gap-3 border-b bg-blue-50 px-4 py-2 dark:bg-blue-950/30">
              <div className="w-12 shrink-0 pt-0.5 text-right font-medium text-[10px] text-muted-foreground uppercase tracking-wider">
                {t("allDay")}
              </div>
              <div className="flex flex-1 flex-wrap gap-1.5">
                {allDayEvents.map((ev) => (
                  <CalendarTaskPill key={ev.id} event={ev} />
                ))}
              </div>
            </div>
          )}

          {/* Time grid */}
          <div
            className="relative flex overflow-y-auto"
            style={{ maxHeight: "calc(100vh - 290px)", minHeight: "400px" }}
          >
            {/* Time labels */}
            <div className="relative w-14 shrink-0 select-none border-r" style={{ height: `${TOTAL_HEIGHT}px` }}>
              {HOURS.map((h) => (
                <div
                  key={h}
                  className="absolute right-0 flex items-start justify-end pr-2"
                  style={{ top: `${Math.max(2, (h - HOUR_START) * HOUR_HEIGHT - 8)}px` }}
                >
                  <span className="font-medium text-[10px] text-muted-foreground/70 tabular-nums">
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
                  className="absolute right-0 left-0 border-muted/60 border-t"
                  style={{ top: `${(h - HOUR_START) * HOUR_HEIGHT}px` }}
                />
              ))}
              {/* Half-hour lines */}
              {HOURS.slice(0, -1).map((h) => (
                <div
                  key={`${h}-half`}
                  className="absolute right-0 left-0 border-muted/30 border-t border-dashed"
                  style={{ top: `${(h - HOUR_START) * HOUR_HEIGHT + HOUR_HEIGHT / 2}px` }}
                />
              ))}

              {/* Empty state */}
              {layoutEvents.length === 0 && allDayEvents.length === 0 && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                  <CalendarDays className="h-10 w-10 opacity-20" />
                  <p className="text-sm">{t("noEventsThisDay")}</p>
                  <AppointmentDialog defaultDate={`${format(baseDate, "yyyy-MM-dd")}T09:00`} />
                </div>
              )}

              {/* Event blocks */}
              {layoutEvents.map(({ event: ev, startMin, endMin, col, numCols }) => {
                const clampedStart = Math.max(startMin, HOUR_START * 60);
                const clampedEnd = Math.min(endMin, HOUR_END * 60);
                if (clampedEnd <= clampedStart) return null;

                const top = ((clampedStart - HOUR_START * 60) / 60) * HOUR_HEIGHT;
                const height = Math.max(((clampedEnd - clampedStart) / 60) * HOUR_HEIGHT, 28);
                const leftPct = (col / numCols) * 100;
                const widthPct = 100 / numCols;

                const ts = getTypeStyle(ev.type);
                const Icon = ts.icon;
                const endAtRaw = (ev as any).endAt;

                return (
                  <Link
                    key={ev.id}
                    href={ev.link}
                    className="absolute px-1 py-0.5"
                    style={{ top: `${top}px`, height: `${height}px`, left: `${leftPct}%`, width: `${widthPct}%` }}
                  >
                    <div
                      className={`flex h-full flex-col overflow-hidden rounded-[3px] border-l-[3px] px-2 py-1 transition-opacity hover:opacity-80 ${ts.pill}`}
                    >
                      <div className="flex items-center gap-1 font-semibold text-xs leading-tight">
                        <Icon className="h-3 w-3 shrink-0" />
                        <span className="truncate">{ev.displayTitle}</span>
                      </div>
                      {height >= 44 && (
                        <div className="mt-0.5 truncate text-[10px] leading-tight opacity-75">
                          {format(new Date(ev.date), "HH:mm")}
                          {endAtRaw && ` – ${format(new Date(endAtRaw), "HH:mm")}`}
                        </div>
                      )}
                      {height >= 60 && ev.entityName && ev.entityName !== "No Entity" && (
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
    );
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4 p-6">
      {/* ── Header ── */}
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        {/* Left: title + stats + legend inline */}
        <div>
          <h1 className="font-bold text-2xl tracking-tight">{t("title")}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-3 text-muted-foreground text-sm">
            <span className="flex items-center gap-1.5">
              <CalendarDays className="h-3.5 w-3.5" />
              <span className="font-semibold text-foreground">{todayEvents.length}</span> {t("today")}
            </span>
            <span className="text-muted-foreground/40">·</span>
            <span className="flex items-center gap-1.5">
              <Columns3 className="h-3.5 w-3.5" />
              <span className="font-semibold text-foreground">{weekEvents.length}</span> {t("thisWeek")}
            </span>
            {overdueEvents.length > 0 && (
              <>
                <span className="text-muted-foreground/40">·</span>
                <OverdueTasksPopover tasks={overdueEvents} />
              </>
            )}
            <span className="text-muted-foreground/40">·</span>
            {Object.entries(TYPE_STYLES).map(([key, cfg]) => {
              const label =
                {
                  task: t("typeTask"),
                  meeting: t("typeMeeting"),
                  call: t("typeCall"),
                  appointment: t("typeAppointment"),
                }[key] ?? key;
              return (
                <span key={key} className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${cfg.dot}`} />
                  {label}
                </span>
              );
            })}
          </div>
        </div>

        {/* Right: controls */}
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {/* View toggle */}
          <div className="flex rounded-lg border bg-muted/40 p-0.5">
            {(["month", "week", "agenda"] as const).map((v) => {
              const ICONS = { month: LayoutGrid, week: Columns3, agenda: List };
              const LABELS = { month: t("month"), week: t("week"), agenda: t("agenda") };
              const Icon = ICONS[v];
              const isActive = currentView === v;
              return (
                <Link
                  key={v}
                  href={calUrl(v, format(baseDate, "yyyy-MM-dd"), currentFilter)}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium text-xs transition-all ${
                    isActive ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {LABELS[v]}
                </Link>
              );
            })}
          </div>

          {/* Filter toggle */}
          <div className="flex rounded-lg border bg-muted/40 p-0.5">
            {(["all", "mine", "group"] as CalendarFilter[]).map((f) => {
              const LABELS: Record<CalendarFilter, string> = {
                all: t("filterAll"),
                mine: t("filterMine"),
                group: t("filterGroup"),
              };
              const isActive = currentFilter === f;
              return (
                <Link
                  key={f}
                  href={calUrl(currentView, format(baseDate, "yyyy-MM-dd"), f)}
                  className={`rounded-md px-3 py-1.5 font-medium text-xs transition-all ${
                    isActive ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {LABELS[f]}
                </Link>
              );
            })}
          </div>

          {/* Navigation */}
          {currentView !== "agenda" && (
            <div className="flex items-center gap-1 rounded-lg border bg-muted/40 p-0.5">
              <Link
                href={prevUrl}
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-all hover:bg-background hover:text-foreground"
              >
                <ChevronLeft className="h-4 w-4" />
              </Link>
              <span className="min-w-[148px] px-2 text-center font-semibold text-sm">{periodTitle}</span>
              <Link
                href={nextUrl}
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-all hover:bg-background hover:text-foreground"
              >
                <ChevronRight className="h-4 w-4" />
              </Link>
            </div>
          )}

          {/* Today */}
          {currentView !== "agenda" && (
            <Button variant="outline" size="sm" asChild>
              <Link href={todayUrl}>{t("today")}</Link>
            </Button>
          )}

          <AppointmentDialog defaultDate={dateParam ? `${dateParam}T09:00` : undefined} />
        </div>
      </div>

      {/* ── Calendar view ── */}
      <div>
        {currentView === "month" && renderMonth()}
        {currentView === "week" && renderWeek()}
        {currentView === "agenda" && renderAgenda()}
      </div>

      {/* ── Appointment detail sheet ── */}
      <AppointmentDetailSheet
        appointmentId={appointmentId ?? null}
        closePath={calUrl(viewParam ?? "week", dateParam ?? format(today, "yyyy-MM-dd"), currentFilter)}
      />
    </div>
  );
}
