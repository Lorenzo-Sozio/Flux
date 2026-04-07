import { getCalendarEvents } from "@/actions/calendar";
import { Badge } from "@/components/ui/badge";
import {
  format,
  startOfMonth, endOfMonth,
  startOfWeek, endOfWeek,
  eachDayOfInterval,
  isSameMonth, isSameDay, isSameWeek,
  addMonths, subMonths,
  addWeeks, subWeeks,
  startOfDay, isAfter, isBefore,
} from "date-fns";
import {
  ChevronLeft, ChevronRight,
  CalendarDays, PhoneCall, Users, CheckSquare,
  LayoutGrid, Columns3, List,
  Clock, AlertCircle,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { FormattedTime } from "@/components/crm/formatted-time";
import { CalendarNewEventButton } from "@/components/crm/calendar-new-event-button";

// ─── Event type helpers ───────────────────────────────────────────────────────

type CalendarEvent = Awaited<ReturnType<typeof getCalendarEvents>>[number];

const TYPE = {
  task:    { label: "Task",    pill: "bg-blue-100 dark:bg-blue-950/70 text-blue-800 dark:text-blue-200 border-l-blue-500",    dot: "bg-blue-500",    icon: CheckSquare },
  meeting: { label: "Meeting", pill: "bg-violet-100 dark:bg-violet-950/70 text-violet-800 dark:text-violet-200 border-l-violet-500", dot: "bg-violet-500", icon: Users },
  call:    { label: "Call",    pill: "bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-200 border-l-emerald-500", dot: "bg-emerald-500", icon: PhoneCall },
} as const;

function getType(type: string) {
  return TYPE[type as keyof typeof TYPE] ?? TYPE.task;
}

function EventPill({ event, compact = false }: { event: CalendarEvent; compact?: boolean }) {
  const t = getType(event.type);
  const Icon = t.icon;
  return (
    <Link href={event.link} title={`${event.displayTitle} — ${event.entityName}`}>
      <div className={`flex items-center gap-1 rounded border-l-[3px] px-1.5 py-0.5 text-[11px] leading-tight hover:opacity-80 transition-opacity ${t.pill}`}>
        <Icon className="h-2.5 w-2.5 shrink-0" />
        {!compact && event.date && (
          <span className="font-semibold shrink-0 tabular-nums opacity-70">
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
  searchParams: Promise<{ view?: string; date?: string }>;
}) {
  const { view: viewParam, date: dateParam } = await searchParams;
  const currentView = viewParam ?? "month";
  const baseDate = dateParam ? new Date(dateParam) : new Date();
  const today = new Date();

  const events = await getCalendarEvents();

  // ── Quick stats ──────────────────────────────────────────────────────────────
  const todayEvents = events.filter(e => e.date && isSameDay(new Date(e.date), today));
  const weekEvents  = events.filter(e => e.date && isSameWeek(new Date(e.date), today, { weekStartsOn: 1 }));
  const overdueEvents = events.filter(e =>
    e.date && isBefore(new Date(e.date), startOfDay(today)) &&
    e.type === "task" && (e as any).status !== "done"
  );

  // ── Navigation URLs ──────────────────────────────────────────────────────────
  const todayUrl  = `/dashboard/calendar?view=${currentView}&date=${format(today, "yyyy-MM-dd")}`;
  const prevUrl   = currentView === "week"
    ? `/dashboard/calendar?view=week&date=${format(subWeeks(baseDate, 1), "yyyy-MM-dd")}`
    : `/dashboard/calendar?view=month&date=${format(subMonths(baseDate, 1), "yyyy-MM-dd")}`;
  const nextUrl   = currentView === "week"
    ? `/dashboard/calendar?view=week&date=${format(addWeeks(baseDate, 1), "yyyy-MM-dd")}`
    : `/dashboard/calendar?view=month&date=${format(addMonths(baseDate, 1), "yyyy-MM-dd")}`;

  const monthStart = startOfMonth(baseDate);
  const weekStart  = startOfWeek(baseDate, { weekStartsOn: 1 });

  const periodTitle = currentView === "week"
    ? `${format(weekStart, "MMM d")} – ${format(endOfWeek(baseDate, { weekStartsOn: 1 }), "MMM d, yyyy")}`
    : format(monthStart, "MMMM yyyy");

  // ── VIEW: Month ──────────────────────────────────────────────────────────────
  const renderMonth = () => {
    const startDate  = startOfWeek(startOfMonth(baseDate), { weekStartsOn: 1 });
    const endDate    = endOfWeek(endOfMonth(baseDate), { weekStartsOn: 1 });
    const calDays    = eachDayOfInterval({ start: startDate, end: endDate });
    const DAYS       = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const MAX_VISIBLE = 3;

    return (
      <div className="rounded-xl border bg-card overflow-hidden shadow-sm">
        {/* Day headers */}
        <div className="grid grid-cols-7 border-b bg-muted/40">
          {DAYS.map((d, i) => (
            <div
              key={d}
              className={`py-2.5 text-center text-xs font-semibold uppercase tracking-wider ${
                i >= 5 ? "text-muted-foreground/60" : "text-muted-foreground"
              }`}
            >
              {d}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7 divide-x divide-y">
          {calDays.map((day, idx) => {
            const dayEvents    = events.filter(e => e.date && isSameDay(new Date(e.date), day));
            const inMonth      = isSameMonth(day, baseDate);
            const isToday      = isSameDay(day, today);
            const isWeekend    = idx % 7 >= 5;
            const overflow     = dayEvents.length - MAX_VISIBLE;
            const agendaUrl    = `/dashboard/calendar?view=agenda&date=${format(day, "yyyy-MM-dd")}`;

            return (
              <div
                key={day.toISOString()}
                className={`min-h-[130px] p-2 flex flex-col gap-1 transition-colors ${
                  isToday       ? "bg-primary/[0.04] dark:bg-primary/[0.06]"
                  : !inMonth    ? "bg-muted/30 dark:bg-muted/10"
                  : isWeekend   ? "bg-muted/10"
                  : "bg-background"
                }`}
              >
                {/* Date number */}
                <div className="flex items-center justify-end mb-0.5">
                  {isToday ? (
                    <span className="h-6 w-6 flex items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">
                      {format(day, "d")}
                    </span>
                  ) : (
                    <span className={`text-xs font-semibold ${!inMonth ? "text-muted-foreground/40" : isWeekend ? "text-muted-foreground" : ""}`}>
                      {format(day, "d")}
                    </span>
                  )}
                </div>

                {/* Events */}
                {dayEvents.slice(0, MAX_VISIBLE).map(ev => (
                  <EventPill key={ev.id} event={ev} />
                ))}
                {overflow > 0 && (
                  <Link href={agendaUrl} className="text-[11px] text-muted-foreground hover:text-primary font-medium mt-auto text-center leading-none py-0.5">
                    +{overflow} more
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // ── VIEW: Week ───────────────────────────────────────────────────────────────
  const renderWeek = () => {
    const weekDays = eachDayOfInterval({
      start: weekStart,
      end: endOfWeek(baseDate, { weekStartsOn: 1 }),
    });

    const taskDays    = weekDays.map(d => events.filter(e => e.date && isSameDay(new Date(e.date), d) && e.type === "task"));
    const nonTaskDays = weekDays.map(d => events.filter(e => e.date && isSameDay(new Date(e.date), d) && e.type !== "task"));
    const hasAnyTask    = taskDays.some(arr => arr.length > 0);
    const hasAnyNonTask = nonTaskDays.some(arr => arr.length > 0);

    return (
      <div className="rounded-xl border bg-card overflow-hidden shadow-sm">
        {/* Column headers */}
        <div className="grid grid-cols-7 border-b bg-muted/40">
          {weekDays.map(day => {
            const isToday = isSameDay(day, today);
            return (
              <div
                key={day.toISOString()}
                className={`py-3 text-center border-r last:border-r-0 ${isToday ? "bg-primary/5" : ""}`}
              >
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {format(day, "EEE")}
                </div>
                <div className={`mt-0.5 text-xl font-bold ${isToday ? "text-primary" : ""}`}>
                  {format(day, "d")}
                </div>
                <div className="text-[10px] text-muted-foreground/60 mt-0.5">
                  {format(day, "MMM")}
                </div>
              </div>
            );
          })}
        </div>

        {/* Tasks row */}
        {hasAnyTask && (
          <div className="border-b">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 dark:bg-blue-950/30 border-b">
              <CheckSquare className="h-3.5 w-3.5 text-blue-500" />
              <span className="text-xs font-semibold text-blue-700 dark:text-blue-300 uppercase tracking-wider">Tasks</span>
            </div>
            <div className="grid grid-cols-7 divide-x min-h-[80px]">
              {weekDays.map((day, idx) => (
                <div key={day.toISOString()} className={`p-2 space-y-1 ${isSameDay(day, today) ? "bg-primary/[0.02]" : ""}`}>
                  {taskDays[idx].map(ev => (
                    <EventPill key={ev.id} event={ev} />
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Meetings & Calls row */}
        {hasAnyNonTask && (
          <div>
            <div className="flex items-center gap-2 px-3 py-1.5 bg-violet-50 dark:bg-violet-950/30 border-b">
              <Users className="h-3.5 w-3.5 text-violet-500" />
              <span className="text-xs font-semibold text-violet-700 dark:text-violet-300 uppercase tracking-wider">Meetings & Calls</span>
            </div>
            <div className="grid grid-cols-7 divide-x min-h-[80px]">
              {weekDays.map((day, idx) => (
                <div key={day.toISOString()} className={`p-2 space-y-1.5 ${isSameDay(day, today) ? "bg-primary/[0.02]" : ""}`}>
                  {nonTaskDays[idx].map(ev => (
                    <EventPill key={ev.id} event={ev} />
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {!hasAnyTask && !hasAnyNonTask && (
          <div className="py-16 text-center text-sm text-muted-foreground">
            No events scheduled for this week.
          </div>
        )}
      </div>
    );
  };

  // ── VIEW: Agenda ─────────────────────────────────────────────────────────────
  const renderAgenda = () => {
    // Filter from the selected base date onwards (or today if in month/default view)
    const from = startOfDay(baseDate);
    const upcoming = [...events]
      .filter(e => e.date && !isBefore(new Date(e.date), from))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    if (upcoming.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-24 border-2 border-dashed rounded-xl text-muted-foreground gap-3">
          <CalendarDays className="h-12 w-12 opacity-20" />
          <p className="text-sm">No upcoming events.</p>
          <CalendarNewEventButton />
        </div>
      );
    }

    // Group by day
    const grouped = upcoming.reduce<Record<string, CalendarEvent[]>>((acc, ev) => {
      const key = format(new Date(ev.date), "yyyy-MM-dd");
      (acc[key] = acc[key] ?? []).push(ev);
      return acc;
    }, {});

    const dayLabel = (dateStr: string) => {
      const d = new Date(dateStr);
      if (isSameDay(d, today)) return "Today";
      const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
      if (isSameDay(d, tomorrow)) return "Tomorrow";
      return format(d, "EEEE");
    };

    return (
      <div className="space-y-1">
        {Object.entries(grouped).map(([dateStr, dayEvents]) => {
          const d = new Date(dateStr);
          const isToday = isSameDay(d, today);

          return (
            <div key={dateStr} className="rounded-xl overflow-hidden border bg-card shadow-sm">
              {/* Date header */}
              <div className={`flex items-center justify-between px-4 py-2.5 border-b ${isToday ? "bg-primary/5" : "bg-muted/30"}`}>
                <div className="flex items-center gap-3">
                  <div className={`text-2xl font-black tabular-nums leading-none ${isToday ? "text-primary" : ""}`}>
                    {format(d, "d")}
                  </div>
                  <div>
                    <div className={`text-sm font-semibold ${isToday ? "text-primary" : ""}`}>
                      {dayLabel(dateStr)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {format(d, "EEEE, MMMM yyyy")}
                    </div>
                  </div>
                </div>
                <Badge variant="secondary" className="text-xs tabular-nums">
                  {dayEvents.length} {dayEvents.length === 1 ? "event" : "events"}
                </Badge>
              </div>

              {/* Events for this day */}
              <div className="divide-y">
                {dayEvents.map(ev => {
                  const t = getType(ev.type);
                  const Icon = t.icon;
                  return (
                    <Link key={ev.id} href={ev.link}>
                      <div className="flex items-center gap-4 px-4 py-3 hover:bg-muted/30 transition-colors group">
                        {/* Color bar */}
                        <div className={`w-1 self-stretch rounded-full ${t.dot}`} />

                        {/* Icon */}
                        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${t.pill} border-l-0`}>
                          <Icon className="h-4 w-4" />
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold truncate group-hover:text-primary transition-colors">
                              {ev.displayTitle}
                            </span>
                            {(ev as any).priority === "high" && (
                              <AlertCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs text-muted-foreground capitalize">{t.label}</span>
                            {ev.entityName && ev.entityName !== "No Entity" && (
                              <>
                                <span className="text-muted-foreground/40">·</span>
                                <span className="text-xs text-muted-foreground truncate">{ev.entityName}</span>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Time */}
                        <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0 tabular-nums">
                          <Clock className="h-3 w-3" />
                          <FormattedTime date={ev.date} />
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-5 p-6 max-w-[1400px] mx-auto">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        {/* Left: title + stats */}
        <div className="flex items-center gap-3">
          <CalendarDays className="h-6 w-6 text-primary shrink-0" />
          <h1 className="text-xl font-bold">Calendar</h1>
          {todayEvents.length > 0 && (
            <Badge variant="secondary" className="text-xs">
              {todayEvents.length} today
            </Badge>
          )}
        </div>

        {/* Right: controls */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* View toggle */}
          <div className="flex rounded-lg border bg-muted/40 p-0.5">
            {(["month", "week", "agenda"] as const).map((v) => {
              const ICONS = { month: LayoutGrid, week: Columns3, agenda: List };
              const LABELS = { month: "Month", week: "Week", agenda: "Agenda" };
              const Icon = ICONS[v];
              const isActive = currentView === v;
              return (
                <Link
                  key={v}
                  href={`/dashboard/calendar?view=${v}&date=${format(baseDate, "yyyy-MM-dd")}`}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                    isActive
                      ? "bg-background shadow-sm text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {LABELS[v]}
                </Link>
              );
            })}
          </div>

          {/* Navigation */}
          {currentView !== "agenda" && (
            <div className="flex items-center gap-1 rounded-lg border bg-muted/40 p-0.5">
              <Link
                href={prevUrl}
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-background transition-all"
              >
                <ChevronLeft className="h-4 w-4" />
              </Link>
              <span className="min-w-[140px] text-center text-sm font-semibold px-2">
                {periodTitle}
              </span>
              <Link
                href={nextUrl}
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-background transition-all"
              >
                <ChevronRight className="h-4 w-4" />
              </Link>
            </div>
          )}

          {/* Today */}
          {currentView !== "agenda" && (
            <Button variant="outline" size="sm" asChild>
              <Link href={todayUrl}>Today</Link>
            </Button>
          )}

          {/* New Event */}
          <CalendarNewEventButton />
        </div>
      </div>

      {/* ── Stats strip ── */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border bg-card px-4 py-3 flex items-center gap-3">
          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <CalendarDays className="h-4 w-4 text-primary" />
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Today</div>
            <div className="text-lg font-bold leading-tight">{todayEvents.length}
              <span className="text-xs font-normal text-muted-foreground ml-1">events</span>
            </div>
          </div>
        </div>

        <div className="rounded-lg border bg-card px-4 py-3 flex items-center gap-3">
          <div className="h-8 w-8 rounded-full bg-violet-500/10 flex items-center justify-center shrink-0">
            <Columns3 className="h-4 w-4 text-violet-500" />
          </div>
          <div>
            <div className="text-xs text-muted-foreground">This week</div>
            <div className="text-lg font-bold leading-tight">{weekEvents.length}
              <span className="text-xs font-normal text-muted-foreground ml-1">events</span>
            </div>
          </div>
        </div>

        <div className={`rounded-lg border bg-card px-4 py-3 flex items-center gap-3 ${overdueEvents.length > 0 ? "border-red-200 dark:border-red-900/50" : ""}`}>
          <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${overdueEvents.length > 0 ? "bg-red-500/10" : "bg-muted"}`}>
            <AlertCircle className={`h-4 w-4 ${overdueEvents.length > 0 ? "text-red-500" : "text-muted-foreground"}`} />
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Overdue tasks</div>
            <div className={`text-lg font-bold leading-tight ${overdueEvents.length > 0 ? "text-red-600 dark:text-red-400" : ""}`}>
              {overdueEvents.length}
              <span className="text-xs font-normal text-muted-foreground ml-1">tasks</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Legend ── */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        {Object.entries(TYPE).map(([key, cfg]) => (
          <div key={key} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-full ${cfg.dot}`} />
            <span>{cfg.label}</span>
          </div>
        ))}
      </div>

      {/* ── Calendar view ── */}
      <div>
        {currentView === "month" && renderMonth()}
        {currentView === "week"  && renderWeek()}
        {currentView === "agenda" && renderAgenda()}
      </div>
    </div>
  );
}
