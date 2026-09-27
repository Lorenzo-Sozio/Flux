import type { ReactNode } from "react";

import { cookies } from "next/headers";
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
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
  subWeeks,
} from "date-fns";
import { enUS, it as itLocale } from "date-fns/locale";
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
  Repeat,
  Rows3,
  Users,
} from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";

import { getAppointmentStart } from "@/actions/appointments";
import { type CalendarFilter, getCalendarEvents, getExternalCalendar } from "@/actions/calendar";
import { auth } from "@/auth";
import { CalendarOverdueSection } from "@/components/crm/calendar-overdue-section";
import { CalendarTaskPill } from "@/components/crm/calendar-task-pill";
import { OverdueTasksPopover } from "@/components/crm/overdue-tasks-popover";
import { WeekCurrentTimeLine } from "@/components/crm/week-current-time-line";
import { Button } from "@/components/ui/button";
import { DAY_LAYOUT_COOKIE, type DayLayout, resolveDayLayout } from "@/lib/calendar-day-layout";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { toWallValue, wallDiffMinutes } from "@/lib/wall-clock";
import { getWorkspaceTimeZone, wallClock } from "@/lib/workspace-time-zone";

import { AppointmentDetailSheet } from "./_components/appointment-detail-sheet";
import { AppointmentDialog } from "./_components/appointment-dialog";
import { AppointmentLink } from "./_components/appointment-link";
import { DayMovablePill, type DragInfo, TimedEventBlock } from "./_components/calendar-drag";
import { CalendarFilterMenu } from "./_components/calendar-filter-menu";
import { CalendarSlotLayer, NewOnDayButton } from "./_components/calendar-slot-layer";
import { DayLayoutToggle } from "./_components/day-layout-toggle";
import { GridAutoScroll } from "./_components/grid-auto-scroll";
import { SubscribeDialog } from "./_components/subscribe-dialog";
import { SwipeNav } from "./_components/swipe-nav";

// ─── URL helper ──────────────────────────────────────────────────────────────

function calUrl(view: string, date: string, filter: string) {
  const p = new URLSearchParams({ view, date });
  if (filter !== "all") p.set("filter", filter);
  return `/dashboard/calendar?${p}`;
}

const VIEWS = ["month", "week", "agenda", "list"] as const;
type View = (typeof VIEWS)[number];

/** How many days the list view covers from its first one. */
const LIST_DAYS = 30;
/** Free time shorter than this is not worth a row of its own in the day's list. */
const FREE_GAP_MIN = 60;

// ─── Event type helpers ───────────────────────────────────────────────────────

/**
 * An occurrence read from a calendar somebody keeps elsewhere.
 *
 * Shaped like the pills the page already draws so the layout code needs no
 * special case, but a variant of its own so nothing can accidentally treat it as
 * a record: there is no id here that anything in this product owns.
 */
type ExternalPill = {
  id: string;
  title: string;
  date: Date;
  endAt: Date | undefined;
  allDay: boolean;
  type: "external";
  status: string;
  priority: string;
  displayTitle: string;
  entityName: string;
  link: string;
  leadId: string | null;
};

type SourceEvent = Awaited<ReturnType<typeof getCalendarEvents>>[number] | ExternalPill;
type AppointmentEvent = Extract<SourceEvent, { type: "appointment" }>;

/**
 * An event with where it sits on the grid: `at` and `until` are its start and
 * end on the workspace's wall clock (see `wallClock`). They are for layout and
 * labels on the server; `date` stays the real instant, and is what the client
 * components are handed.
 */
type CalendarEvent = SourceEvent & { at: Date; until: Date | undefined; allDayEvent: boolean };

const isAppointment = (e: CalendarEvent): e is CalendarEvent & AppointmentEvent => e.type === "appointment";

/** A task is all day unless it says otherwise; anything else only when it says so. */
function isAllDay(e: SourceEvent): boolean {
  const flag = "allDay" in e ? e.allDay : undefined;
  return e.type === "task" ? flag !== false : flag === true;
}

/** Whether an event has any part on a day: every day of a three-day conference, not just the first. */
function spansDay(ev: CalendarEvent, day: Date): boolean {
  const dayStart = startOfDay(day);
  const next = addDays(dayStart, 1);
  if (!ev.until || ev.until <= ev.at) return isSameDay(ev.at, day);
  return ev.at < next && ev.until > dayStart;
}

type Segment = {
  event: CalendarEvent;
  /** The part of the day it covers, in minutes past midnight. */
  startMin: number;
  endMin: number;
  startsHere: boolean;
  endsHere: boolean;
  col: number;
  numCols: number;
};

const minutesOf = (d: Date) => d.getHours() * 60 + d.getMinutes();

/** The piece of a timed event that falls on one day. */
function segmentOn(ev: CalendarEvent, day: Date): Segment {
  const dayStart = startOfDay(day);
  const next = addDays(dayStart, 1);
  const end = ev.until && ev.until > ev.at ? ev.until : new Date(ev.at.getTime() + 60 * 60_000);
  const startsHere = ev.at >= dayStart;
  const endsHere = end <= next;
  const startMin = startsHere ? minutesOf(ev.at) : 0;
  const endMin = endsHere ? (isSameDay(end, day) ? minutesOf(end) : 1440) : 1440;
  return { event: ev, startMin, endMin: Math.max(endMin, startMin + 15), startsHere, endsHere, col: 0, numCols: 1 };
}

/** Side by side where they overlap: greedy columns, then each takes the width of its cluster. */
function layOut(segments: Segment[]): Segment[] {
  const laid = [...segments].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  // A short event still occupies the height it is drawn at.
  const drawnEnd = (s: Segment) => Math.max(s.endMin, s.startMin + 30);
  const colEnds: number[] = [];
  for (const s of laid) {
    const free = colEnds.findIndex((end) => end <= s.startMin);
    s.col = free === -1 ? colEnds.length : free;
    colEnds[s.col] = drawnEnd(s);
  }
  for (const s of laid) {
    const overlapping = laid.filter((o) => o.startMin < drawnEnd(s) && drawnEnd(o) > s.startMin);
    s.numCols = Math.max(...overlapping.map((o) => o.col + 1));
  }
  return laid;
}

/**
 * The hours a time grid shows: seven to ten at night, stretched to take in
 * anything earlier or later. A fixed window made a half past six meeting vanish
 * from the grid altogether, with nothing on screen to say it existed.
 */
function hourWindow(segments: Segment[]): { start: number; end: number } {
  let start = 7;
  let end = 22;
  for (const s of segments) {
    start = Math.min(start, Math.floor(s.startMin / 60));
    end = Math.max(end, Math.min(24, Math.ceil(s.endMin / 60)));
  }
  return { start, end };
}

const TYPE_STYLES = {
  /**
   * Somebody's own calendar, kept elsewhere and read back in (rilievo S-10).
   *
   * ⚠️ Deliberately grey and deliberately not a link. It is busy time, not a
   * record: there is nothing here to open, nothing to edit, and dressing it like
   * the rest would invite both.
   */
  external: {
    pill: "bg-slate-100 dark:bg-slate-800/70 text-slate-700 dark:text-slate-300 border-l-slate-400",
    dot: "bg-slate-400",
    icon: CalendarDays,
  },
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

const entityOf = (ev: CalendarEvent) => (ev.entityName && ev.entityName !== "No Entity" ? ev.entityName : null);

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    date?: string;
    appointment?: string;
    occurrence?: string;
    filter?: string;
    layout?: string;
  }>;
}) {
  const [
    {
      view: viewParam,
      date: dateParam,
      appointment: appointmentId,
      occurrence: occurrenceParam,
      filter: filterParam,
      layout: layoutParam,
    },
    t,
    session,
    timeZone,
    locale,
    cookieStore,
  ] = await Promise.all([
    searchParams,
    getTranslations("calendar"),
    auth(),
    getWorkspaceTimeZone(),
    getLocale(),
    cookies(),
  ]);
  // The day view as a list or as the hour grid (src/lib/calendar-day-layout.ts).
  const dayLayout = resolveDayLayout(layoutParam, cookieStore.get(DAY_LAYOUT_COOKIE)?.value);
  const dfLocale = locale === "it" ? itLocale : enUS;
  // ⚠️ The workspace role, never the platform one.
  const tenantRole = session?.user?.tenantRole ?? null;
  const canWrite = can(tenantRole, "record:write");
  const canDelete = can(tenantRole, "record:delete");

  const currentView: View = (VIEWS as readonly string[]).includes(viewParam ?? "") ? (viewParam as View) : "week";

  /**
   * ⚠️ Nobody chose the week — it is the default, and on a phone it is seven
   * columns in 390 pixels: three days visible and a grid that has to be dragged
   * sideways to find the fourth. The agenda is the same day, read as a list.
   *
   * So when the view is a *default* rather than a choice, the phone gets the
   * agenda and everything from md up gets the week. Both are rendered and CSS
   * picks; the two share one `events` array, so this costs markup and not a
   * second query. Ask for a view explicitly and you get it at every width.
   */
  const weekIsADefault = !viewParam && currentView === "week";
  const currentFilter = (["all", "mine", "group"].includes(filterParam ?? "") ? filterParam : "all") as CalendarFilter;
  // Everything below reads days and hours on the workspace's wall clock.
  const today = wallClock(new Date(), timeZone);
  // A link to an appointment without a date (search, a notification) opens the
  // week it is in, not this one.
  const occurrenceDate = occurrenceParam ? new Date(occurrenceParam) : null;
  const appointmentStart =
    appointmentId && !dateParam
      ? occurrenceDate && !Number.isNaN(occurrenceDate.getTime())
        ? occurrenceDate
        : await getAppointmentStart(appointmentId).catch(() => null)
      : null;
  const parsedDate = dateParam ? parseISO(dateParam) : null;
  const baseDate =
    parsedDate && !Number.isNaN(parsedDate.getTime())
      ? parsedDate
      : appointmentStart
        ? wallClock(appointmentStart, timeZone)
        : today;
  const baseDateStr = format(baseDate, "yyyy-MM-dd");

  // ── Compute visible range + overdue window ───────────────────────────────────
  const monthStart = startOfMonth(baseDate);
  const weekStart = startOfWeek(baseDate, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(baseDate, { weekStartsOn: 1 });
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
        ? weekEnd
        : currentView === "list"
          ? endOfDay(addDays(baseDate, LIST_DAYS - 1))
          : endOfDay(baseDate);
  // Always extend backwards to cover the 30-day overdue window, and to the end of
  // this week so the header's "this week" count is right whatever is on screen.
  const thirtyDaysAgo = startOfDay(subDays(today, 30));
  const thisWeekEnd = endOfWeek(today, { weekStartsOn: 1 });
  // A day either side: the bounds are wall-clock times and the query compares
  // instants, which differ by the zone's offset.
  // The day view reads its whole week too: the phone's week strip marks which
  // days have something on them.
  const fetchStart = [visibleStart, thirtyDaysAgo, weekStart].reduce((a, b) => (b < a ? b : a));
  const fetchEnd = [visibleEnd, thisWeekEnd, weekEnd].reduce((a, b) => (b > a ? b : a));
  const rangeStart = subDays(fetchStart, 1);
  const rangeEnd = addDays(fetchEnd, 1);

  const [crmEvents, external, tFeed, tApt] = await Promise.all([
    getCalendarEvents(currentFilter, { start: rangeStart, end: rangeEnd }),
    // Never blocks and never throws: a calendar that cannot be reached is shown
    // as empty **and said to be**, because a screen that looks free while
    // somebody is in a meeting is the failure this feature exists to prevent.
    getExternalCalendar({ from: rangeStart, to: rangeEnd }).catch(() => null),
    getTranslations("calendarFeed"),
    getTranslations("appointment"),
  ]);

  const externalEvents: ExternalPill[] = (external?.events ?? []).map((e) => ({
    id: `external:${e.uid}:${e.start.getTime()}`,
    title: e.summary,
    date: e.start,
    endAt: e.end,
    allDay: e.allDay,
    type: "external" as const,
    status: "active",
    priority: "normal",
    displayTitle: e.summary || "—",
    entityName: tFeed("externalBusy"),
    link: "#",
    leadId: null,
  }));

  /**
   * Where this page is, without the appointment: opening one keeps the view,
   * the date and the filter behind it, and closing it comes back to them. The
   * link used to be bare, so clicking a meeting next week jumped to this one.
   */
  const hereParams = new URLSearchParams();
  if (viewParam) hereParams.set("view", currentView);
  hereParams.set("date", baseDateStr);
  if (currentFilter !== "all") hereParams.set("filter", currentFilter);
  const herePath = `/dashboard/calendar?${hereParams}`;

  const events: CalendarEvent[] = ([...crmEvents, ...externalEvents] as SourceEvent[]).map((e) => {
    const endAt = "endAt" in e ? e.endAt : undefined;
    const link =
      e.type === "appointment"
        ? `${herePath}&appointment=${encodeURIComponent(e.appointmentId)}${
            e.occurrence ? `&occurrence=${encodeURIComponent(e.occurrence)}` : ""
          }`
        : e.link;
    return {
      ...e,
      link,
      at: wallClock(new Date(e.date), timeZone),
      until: endAt ? wallClock(new Date(endAt), timeZone) : undefined,
      allDayEvent: isAllDay(e),
    };
  });

  /** How an appointment can be moved by hand; nothing for anything else, or for a reader. */
  const dragFor = (ev: CalendarEvent): DragInfo | undefined => {
    if (!canWrite || !isAppointment(ev)) return undefined;
    const start = new Date(ev.date);
    const end = ev.endAt ? new Date(ev.endAt) : new Date(start.getTime() + 3_600_000);
    return {
      appointmentId: ev.appointmentId,
      occurrence: ev.occurrence,
      recurring: ev.recurring,
      hasInvitees: ev.attendeeCount > 0,
      allDay: ev.allDay,
      startWall: toWallValue(start, timeZone),
      // On the wall clock: an all-day event across the change to summer time
      // lasts a day, not twenty-three hours, and must still end at midnight.
      durationMin: wallDiffMinutes(toWallValue(start, timeZone), toWallValue(end, timeZone)),
      timeZone,
    };
  };

  const muted = (ev: CalendarEvent) => isAppointment(ev) && ev.status === "completed";
  const recurringEvent = (ev: CalendarEvent) => isAppointment(ev) && ev.recurring;

  /** A pill for month cells, the all-day strip and the list: the right kind for each type. */
  const renderPill = (ev: CalendarEvent, day: Date, compact = false) => {
    const ts = getTypeStyle(ev.type);
    if (ev.type === "task") return <CalendarTaskPill key={ev.id} event={ev} compact={compact} />;
    const timeLabel = ev.allDayEvent || !isSameDay(ev.at, day) || compact ? null : format(ev.at, "HH:mm");
    if (ev.type === "external") {
      const Icon = ts.icon;
      return (
        <div
          key={ev.id}
          title={`${ev.displayTitle} — ${ev.entityName}`}
          className={`flex items-center gap-1.5 rounded border-l-[3px] px-1.5 py-1 text-xs leading-tight ${ts.pill}`}
        >
          <Icon className="h-3 w-3 shrink-0" />
          {timeLabel && <span className="shrink-0 font-semibold tabular-nums opacity-70">{timeLabel}</span>}
          <span className="truncate font-medium">{ev.displayTitle}</span>
        </div>
      );
    }
    return (
      <DayMovablePill
        key={ev.id}
        href={ev.link}
        title={ev.displayTitle}
        type={ev.type}
        pillClass={ts.pill}
        timeLabel={timeLabel}
        entityLabel={entityOf(ev)}
        muted={muted(ev)}
        recurring={recurringEvent(ev)}
        drag={dragFor(ev)}
      />
    );
  };

  // ── Quick stats ──────────────────────────────────────────────────────────────
  const todayEvents = events.filter((e) => spansDay(e, today));
  const weekDaysOfToday = eachDayOfInterval({ start: startOfWeek(today, { weekStartsOn: 1 }), end: thisWeekEnd });
  const weekEvents = events.filter((e) => weekDaysOfToday.some((d) => spansDay(e, d)));
  const overdueEvents = events.filter(
    (e) =>
      isBefore(e.at, startOfDay(today)) &&
      !isBefore(e.at, thirtyDaysAgo) &&
      e.type === "task" &&
      (e as { status?: string }).status !== "done",
  );

  // ── Navigation URLs ──────────────────────────────────────────────────────────
  const todayUrl = calUrl(currentView, format(today, "yyyy-MM-dd"), currentFilter);
  const step = (dir: 1 | -1) => {
    if (currentView === "week") return format(dir > 0 ? addWeeks(baseDate, 1) : subWeeks(baseDate, 1), "yyyy-MM-dd");
    if (currentView === "month") return format(dir > 0 ? addMonths(baseDate, 1) : subMonths(baseDate, 1), "yyyy-MM-dd");
    if (currentView === "list") return format(addDays(baseDate, dir * LIST_DAYS), "yyyy-MM-dd");
    return format(addDays(baseDate, dir), "yyyy-MM-dd");
  };
  const prevUrl = calUrl(currentView, step(-1), currentFilter);
  const nextUrl = calUrl(currentView, step(1), currentFilter);

  /**
   * A day, as the phone opens it: the day view, or — when nobody chose a view —
   * the same default without a `view`, so the desktop keeps its week.
   */
  const dayUrl = (day: Date) => {
    const date = format(day, "yyyy-MM-dd");
    if (!weekIsADefault) return calUrl("agenda", date, currentFilter);
    const p = new URLSearchParams({ date });
    if (currentFilter !== "all") p.set("filter", currentFilter);
    return `/dashboard/calendar?${p}`;
  };
  // What a sideways swipe does on a phone: the day view walks days, the others
  // their own period. The default week is the day view on a phone.
  const phoneWalksDays = currentView === "agenda" || weekIsADefault;
  const swipePrev = phoneWalksDays ? dayUrl(subDays(baseDate, 1)) : prevUrl;
  const swipeNext = phoneWalksDays ? dayUrl(addDays(baseDate, 1)) : nextUrl;

  const periodTitle =
    currentView === "week"
      ? `${format(weekStart, "d MMM", { locale: dfLocale })} – ${format(weekEnd, "d MMM yyyy", { locale: dfLocale })}`
      : currentView === "list"
        ? `${format(baseDate, "d MMM", { locale: dfLocale })} – ${format(addDays(baseDate, LIST_DAYS - 1), "d MMM yyyy", { locale: dfLocale })}`
        : format(monthStart, "LLLL yyyy", { locale: dfLocale });

  const DAY_NAMES: Record<number, string> = {
    1: t("days.mon"),
    2: t("days.tue"),
    3: t("days.wed"),
    4: t("days.thu"),
    5: t("days.fri"),
    6: t("days.sat"),
    0: t("days.sun"),
  };

  /**
   * The hour a time grid opens on: an hour before now on today's, otherwise just
   * before the first timed thing in view, and eight o'clock when there is none.
   */
  const openingHour = (segments: Segment[], includesToday: boolean) => {
    if (includesToday) return Math.max(0, today.getHours() - 1);
    const first = segments.reduce((min, s) => Math.min(min, s.startMin), 24 * 60);
    return first < 24 * 60 ? Math.floor(first / 60) : 8;
  };

  const segmentLabel = (s: Segment) => {
    const from = s.startsHere ? format(s.event.at, "HH:mm") : "…";
    const until = s.event.until && s.endsHere ? format(s.event.until, "HH:mm") : s.event.until ? "…" : null;
    return until ? `${from} – ${until}` : from;
  };

  /** One time grid block, for the week and the day view alike. */
  const renderBlock = (
    s: Segment,
    grid: { hourStart: number; hourEnd: number; hourHeight: number; minHeight: number; variant: "week" | "agenda" },
  ) => {
    const clampedStart = Math.max(s.startMin, grid.hourStart * 60);
    const clampedEnd = Math.min(Math.max(s.endMin, s.startMin + 30), grid.hourEnd * 60);
    if (clampedEnd <= clampedStart) return null;
    const ev = s.event;
    const onlyHere = s.startsHere && s.endsHere;
    return (
      <TimedEventBlock
        key={`${ev.id}:${s.startMin}`}
        href={ev.type === "external" ? null : ev.link}
        title={ev.displayTitle}
        type={ev.type}
        pillClass={getTypeStyle(ev.type).pill}
        timeLabel={segmentLabel(s)}
        entityLabel={entityOf(ev)}
        top={((clampedStart - grid.hourStart * 60) / 60) * grid.hourHeight}
        height={Math.max(((clampedEnd - clampedStart) / 60) * grid.hourHeight, grid.minHeight)}
        leftPct={(s.col / s.numCols) * 100}
        widthPct={100 / s.numCols}
        variant={grid.variant}
        muted={muted(ev)}
        recurring={recurringEvent(ev)}
        startMin={s.startMin}
        endMin={s.endMin}
        hourHeight={grid.hourHeight}
        // Only a block wholly on its own day can be dragged within it.
        drag={onlyHere ? dragFor(ev) : undefined}
      />
    );
  };

  const hourLines = (hours: number[], hourStart: number, hourHeight: number) => (
    <>
      {hours.map((h) => (
        <div
          key={h}
          className="pointer-events-none absolute right-0 left-0 border-muted/60 border-t"
          style={{ top: `${(h - hourStart) * hourHeight}px` }}
        />
      ))}
      {hours.slice(0, -1).map((h) => (
        <div
          key={`${h}-half`}
          className="pointer-events-none absolute right-0 left-0 border-muted/30 border-t border-dashed"
          style={{ top: `${(h - hourStart) * hourHeight + hourHeight / 2}px` }}
        />
      ))}
    </>
  );

  const hourLabels = (hours: number[], hourStart: number, hourHeight: number) =>
    hours.map((h) => (
      <div
        key={h}
        className="absolute right-0 flex items-start justify-end pr-2"
        style={{ top: `${Math.max(2, (h - hourStart) * hourHeight - 8)}px` }}
      >
        <span className="font-medium text-[10px] text-muted-foreground/70 tabular-nums">
          {h === 24 ? "24:00" : `${h.toString().padStart(2, "0")}:00`}
        </span>
      </div>
    ));

  /**
   * The phone's week strip: seven days, a dot for each that has something on it,
   * the chosen one filled in. It is how a day is picked on a phone — one tap —
   * where the arrows walked there one day at a time without saying which days
   * were busy. Sticky, so it stays under the thumb while the day scrolls.
   */
  const renderWeekStrip = ({
    selected,
    dayHref,
    prevHref,
    nextHref,
    extra,
  }: {
    selected: Date | null;
    dayHref: (day: Date) => string;
    prevHref: string;
    nextHref: string;
    /** Beside the headline: the day view's list/grid switch. */
    extra?: ReactNode;
  }) => {
    const anchor = selected ?? baseDate;
    const days = eachDayOfInterval({
      start: startOfWeek(anchor, { weekStartsOn: 1 }),
      end: endOfWeek(anchor, { weekStartsOn: 1 }),
    });
    const headline = selected ?? anchor;
    const showingToday = selected ? isSameDay(selected, today) : days.some((d) => isSameDay(d, today));
    return (
      <div
        data-no-swipe=""
        className="-mx-4 sticky top-0 z-20 border-b bg-background/95 px-2 pt-2 pb-1.5 backdrop-blur-md md:hidden"
      >
        <div className="flex items-center justify-between gap-2 px-2 pb-1">
          <p className="min-w-0 truncate font-semibold text-sm capitalize">
            {selected
              ? `${isSameDay(selected, today) ? `${t("today")} · ` : ""}${format(headline, "EEEE d MMMM", { locale: dfLocale })}`
              : format(headline, "LLLL yyyy", { locale: dfLocale })}
          </p>
          <div className="flex shrink-0 items-center gap-1">
            {!showingToday && (
              <Link href={dayHref(today)} className="shrink-0 rounded-md px-2 py-1 font-medium text-primary text-sm">
                {t("today")}
              </Link>
            )}
            {extra}
          </div>
        </div>
        <div className="flex items-center">
          <Link
            href={prevHref}
            aria-label={t("previousPeriod")}
            className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground active:bg-muted"
          >
            <ChevronLeft className="size-5" />
          </Link>
          <ol className="grid min-w-0 flex-1 grid-cols-7">
            {days.map((day) => {
              const isSelected = selected ? isSameDay(day, selected) : false;
              const isToday = isSameDay(day, today);
              const busy = events.filter((e) => spansDay(e, day));
              return (
                <li key={day.toISOString()}>
                  <Link
                    href={dayHref(day)}
                    scroll={false}
                    aria-current={isSelected ? "date" : undefined}
                    aria-label={`${format(day, "PPPP", { locale: dfLocale })}, ${t("eventCount", { count: busy.length })}`}
                    className="flex flex-col items-center gap-0.5 rounded-xl py-1"
                  >
                    <span className="font-medium text-[10px] text-muted-foreground uppercase">
                      {DAY_NAMES[day.getDay()].slice(0, 3)}
                    </span>
                    <span
                      className={cn(
                        "flex size-8 items-center justify-center rounded-full font-semibold text-sm tabular-nums",
                        isSelected
                          ? "bg-primary text-primary-foreground"
                          : isToday
                            ? "text-primary ring-1 ring-primary/40"
                            : "text-foreground",
                      )}
                    >
                      {format(day, "d")}
                    </span>
                    <span className="flex h-1.5 items-center gap-0.5" aria-hidden>
                      {busy.slice(0, 3).map((ev) => (
                        <span key={ev.id} className={cn("size-1 rounded-full", getTypeStyle(ev.type).dot)} />
                      ))}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
          <Link
            href={nextHref}
            aria-label={t("nextPeriod")}
            className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground active:bg-muted"
          >
            <ChevronRight className="size-5" />
          </Link>
        </div>
      </div>
    );
  };

  /** One event as a row: the list view, and the chosen day under the month on a phone. */
  const renderRow = (ev: CalendarEvent, day: Date) => {
    const ts = getTypeStyle(ev.type);
    const Icon = ts.icon;
    const s = ev.allDayEvent ? null : segmentOn(ev, day);
    const time = ev.allDayEvent ? t("allDay") : s ? segmentLabel(s) : "";
    const entity = entityOf(ev);
    const inner = (
      <>
        <span className="w-[5.5rem] shrink-0 text-muted-foreground text-xs tabular-nums">{time}</span>
        <span className={cn("size-2 shrink-0 rounded-full", ts.dot)} aria-hidden />
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate font-medium text-sm", muted(ev) && "line-through opacity-60")}>
            {ev.displayTitle}
          </span>
          {entity && <span className="block truncate text-muted-foreground text-xs">{entity}</span>}
        </span>
        {recurringEvent(ev) && (
          <Repeat className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label={tApt("recurrence.label")} />
        )}
      </>
    );
    const rowClass = "flex min-h-12 items-center gap-3 px-4 py-2 transition-colors hover:bg-muted/40";
    return (
      <li key={ev.id}>
        {ev.type === "external" ? (
          <div className={cn(rowClass, "hover:bg-transparent")}>{inner}</div>
        ) : ev.type === "appointment" ? (
          <AppointmentLink href={ev.link} className={rowClass}>
            {inner}
          </AppointmentLink>
        ) : (
          <Link href={ev.link} scroll={false} className={rowClass}>
            {inner}
          </Link>
        )}
      </li>
    );
  };

  // ── VIEW: Month ──────────────────────────────────────────────────────────────
  const renderMonth = () => {
    const startDate = startOfWeek(startOfMonth(baseDate), { weekStartsOn: 1 });
    const endDate = endOfWeek(endOfMonth(baseDate), { weekStartsOn: 1 });
    const calDays = eachDayOfInterval({ start: startDate, end: endDate });
    const DAYS = [1, 2, 3, 4, 5, 6, 0].map((d) => DAY_NAMES[d]);
    const MAX_VISIBLE = 4;
    const chosenDay = events
      .filter((e) => spansDay(e, baseDate))
      .sort((a, b) => Number(b.allDayEvent) - Number(a.allDayEvent) || a.at.getTime() - b.at.getTime());

    return (
      <div className="space-y-3">
        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
          {/* Day headers */}
          <div className="grid grid-cols-7 border-b bg-muted/40">
            {DAYS.map((d, i) => (
              <div
                key={d}
                className={`py-2 text-center font-semibold text-[10px] uppercase tracking-wider md:py-3 md:text-xs ${
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
              // All-day and multi-day first, then by time: the order every calendar uses.
              const dayEvents = events
                .filter((e) => spansDay(e, day))
                .sort((a, b) => Number(b.allDayEvent) - Number(a.allDayEvent) || a.at.getTime() - b.at.getTime());
              const inMonth = isSameMonth(day, baseDate);
              const isToday = isSameDay(day, today);
              const isWeekend = idx % 7 >= 5;
              const overflow = dayEvents.length - MAX_VISIBLE;
              const dayStr = format(day, "yyyy-MM-dd");
              const agendaUrl = calUrl("agenda", dayStr, currentFilter);
              const isChosen = isSameDay(day, baseDate);

              return (
                <div
                  key={day.toISOString()}
                  data-cal-day={dayStr}
                  // ⚠️ Seven columns on a 343px screen is 49px a day. A month grid
                  // cannot show an appointment's name in 49px, so below md it
                  // shows the count as dots and the day itself is the link to its
                  // agenda — which is where the names are readable. The full grid
                  // comes back from md up, where a cell is 130px or more.
                  className={`group relative flex min-h-[56px] min-w-0 flex-col gap-1 p-1 transition-colors md:min-h-[160px] md:gap-1 md:p-2 ${
                    isChosen ? "max-md:ring-2 max-md:ring-primary max-md:ring-inset" : ""
                  } ${
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
                  <div className="mb-0.5 flex items-center justify-end gap-1">
                    {canWrite && (
                      <span className="mr-auto hidden md:inline-flex">
                        <NewOnDayButton day={dayStr} />
                      </span>
                    )}
                    <Link
                      href={agendaUrl}
                      className="rounded-full hover:ring-2 hover:ring-primary/30 max-md:pointer-events-none"
                      aria-label={format(day, "PPPP", { locale: dfLocale })}
                    >
                      {isToday ? (
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary font-bold text-primary-foreground text-xs">
                          {format(day, "d")}
                        </span>
                      ) : (
                        <span
                          className={`flex h-6 w-6 items-center justify-center font-semibold text-xs ${!inMonth ? "text-muted-foreground/40" : isWeekend ? "text-muted-foreground/60" : "text-muted-foreground"}`}
                        >
                          {format(day, "d")}
                        </span>
                      )}
                    </Link>
                  </div>

                  {/* Phone: one dot per event, up to four; the whole cell picks the
                    day, and its events are listed under the grid — the way a
                    phone's own calendar reads a month, without leaving it. */}
                  <Link
                    href={calUrl("month", dayStr, currentFilter)}
                    scroll={false}
                    aria-label={`${format(day, "PPPP", { locale: dfLocale })}, ${t("eventCount", { count: dayEvents.length })}`}
                    aria-current={isChosen ? "date" : undefined}
                    className="absolute inset-0 md:hidden"
                  />
                  {dayEvents.length > 0 && (
                    <div
                      className="pointer-events-none flex flex-1 flex-wrap content-start items-start gap-0.5 md:hidden"
                      aria-hidden
                    >
                      {dayEvents.slice(0, 4).map((ev) => (
                        <span key={ev.id} className={cn("size-1.5 rounded-full", getTypeStyle(ev.type).dot)} />
                      ))}
                      {dayEvents.length > 4 && (
                        <span className="font-medium text-[9px] text-muted-foreground leading-none">
                          +{dayEvents.length - 4}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Tablet and up: the appointments themselves. */}
                  <div className="hidden min-w-0 flex-1 flex-col gap-1 md:flex">
                    {dayEvents.slice(0, MAX_VISIBLE).map((ev) => renderPill(ev, day, false))}
                    {overflow > 0 && (
                      <Link
                        href={agendaUrl}
                        className="mt-auto py-0.5 text-center font-medium text-[11px] text-muted-foreground leading-none hover:text-primary"
                      >
                        {t("more", { count: overflow })}
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Phone: the chosen day, read as a list under the grid. */}
        <section
          className="overflow-hidden rounded-xl border bg-card shadow-sm md:hidden"
          aria-labelledby="cal-chosen-day"
        >
          <div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-4 py-2.5">
            <h2 id="cal-chosen-day" className="min-w-0 truncate font-semibold text-sm capitalize">
              {isSameDay(baseDate, today) ? `${t("today")} · ` : ""}
              {format(baseDate, "EEEE d MMMM", { locale: dfLocale })}
            </h2>
            <Link
              href={calUrl("agenda", baseDateStr, currentFilter)}
              className="shrink-0 font-medium text-primary text-xs"
            >
              {t("agenda")}
            </Link>
          </div>
          {chosenDay.length > 0 ? (
            <ul className="divide-y">{chosenDay.map((ev) => renderRow(ev, baseDate))}</ul>
          ) : (
            <p className="px-4 py-6 text-center text-muted-foreground text-sm">{t("noEventsThisDay")}</p>
          )}
        </section>
      </div>
    );
  };

  // ── VIEW: Week, on a phone ──────────────────────────────────────────────────
  /**
   * Seven 116px columns scrolled sideways showed two and a half days of a week
   * on a phone. The week is read here as the phone reads anything long: day by
   * day, top to bottom, with the strip above to jump into any one of them.
   */
  const renderWeekPhone = () => {
    const days = eachDayOfInterval({ start: weekStart, end: weekEnd });
    return (
      <div className="space-y-3 md:hidden">
        {renderWeekStrip({
          selected: null,
          dayHref: (d) => calUrl("agenda", format(d, "yyyy-MM-dd"), currentFilter),
          prevHref: prevUrl,
          nextHref: nextUrl,
        })}
        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
          {days.map((day) => {
            const items = events
              .filter((e) => spansDay(e, day))
              .sort((a, b) => Number(b.allDayEvent) - Number(a.allDayEvent) || a.at.getTime() - b.at.getTime());
            const isToday = isSameDay(day, today);
            return (
              <section key={day.toISOString()} className="border-b last:border-b-0">
                <Link
                  href={calUrl("agenda", format(day, "yyyy-MM-dd"), currentFilter)}
                  className={cn("flex items-baseline gap-2 bg-muted/40 px-4 py-2", isToday && "bg-primary/5")}
                >
                  <span className={cn("font-bold text-lg tabular-nums", isToday && "text-primary")}>
                    {format(day, "d")}
                  </span>
                  <span className="font-medium text-sm capitalize">{format(day, "EEEE", { locale: dfLocale })}</span>
                  {isToday && <span className="ml-auto font-medium text-primary text-xs">{t("today")}</span>}
                </Link>
                {items.length > 0 ? (
                  <ul className="divide-y">{items.map((ev) => renderRow(ev, day))}</ul>
                ) : (
                  <p className="px-4 py-3 text-muted-foreground text-xs">{t("noEventsThisDay")}</p>
                )}
              </section>
            );
          })}
        </div>
      </div>
    );
  };

  // ── VIEW: Week (time-grid) ───────────────────────────────────────────────────
  const renderWeek = () => {
    const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd });

    const allDayByDay = weekDays.map((d) => events.filter((e) => e.allDayEvent && spansDay(e, d)));
    const hasAnyAllDay = allDayByDay.some((arr) => arr.length > 0);
    const layoutByDay = weekDays.map((d) =>
      layOut(events.filter((e) => !e.allDayEvent && spansDay(e, d)).map((e) => segmentOn(e, d))),
    );
    const span = hourWindow(layoutByDay.flat());
    const HOUR_START = span.start;
    const HOUR_END = span.end;
    const HOUR_HEIGHT = 56;
    const HOURS = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i);
    const TOTAL_HEIGHT = (HOUR_END - HOUR_START) * HOUR_HEIGHT;

    // ⚠️ `minmax(0, …)` let a day column fall to 42px on a phone, which is not
    // enough for the hour of an appointment, never mind its name. A floor of
    // 116px changes nothing above about 900px — the columns are wider than that
    // anyway — and below it the grid scrolls sideways a day at a time, which is
    // how a week is read on a phone.
    const gridCols = "48px repeat(7, minmax(116px, 1fr))";

    return (
      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        {/* Single scroll container — headers, all-day strip, and time grid all share identical width */}
        <div
          data-cal-scroll=""
          className="overflow-auto"
          style={{ maxHeight: "calc(100dvh - 280px)", minHeight: "480px", scrollbarGutter: "stable" }}
        >
          <GridAutoScroll
            offsetPx={
              (openingHour(
                layoutByDay.flat(),
                weekDays.some((d) => isSameDay(d, today)),
              ) -
                HOUR_START) *
                HOUR_HEIGHT -
              HOUR_HEIGHT / 2
            }
          />
          {/* Sticky wrapper: day headers + all-day strip pinned together at top */}
          <div className="sticky top-0 z-40">
            {/* Day headers */}
            <div
              className="border-b bg-muted/40 backdrop-blur"
              style={{ display: "grid", gridTemplateColumns: gridCols }}
            >
              <div className="border-r" />
              {weekDays.map((day) => {
                const isToday = isSameDay(day, today);
                return (
                  <Link
                    key={day.toISOString()}
                    href={calUrl("agenda", format(day, "yyyy-MM-dd"), currentFilter)}
                    className={`border-r py-3 text-center transition-colors last:border-r-0 hover:bg-muted/60 ${isToday ? "bg-primary/5" : ""}`}
                  >
                    <div className="font-semibold text-[11px] text-muted-foreground uppercase tracking-wider">
                      {DAY_NAMES[day.getDay()]}
                    </div>
                    <div className={`mt-1 font-bold text-2xl tabular-nums ${isToday ? "text-primary" : ""}`}>
                      {format(day, "d")}
                    </div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground/60">
                      {format(day, "MMM", { locale: dfLocale })}
                    </div>
                  </Link>
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
                  className="whitespace-nowrap font-medium text-[10px] text-muted-foreground/60 uppercase tracking-wider"
                  style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
                >
                  {t("allDay")}
                </span>
              </div>
              {weekDays.map((day, idx) => {
                const isToday = isSameDay(day, today);
                const dayStr = format(day, "yyyy-MM-dd");
                return (
                  <div
                    key={day.toISOString()}
                    data-cal-day={dayStr}
                    className={`group relative min-w-0 border-r p-1.5 last:border-r-0 ${isToday ? "bg-primary/[0.02]" : ""}`}
                    style={{ minHeight: "36px" }}
                  >
                    {canWrite && (
                      <span className="absolute top-1 right-1">
                        <NewOnDayButton day={dayStr} allDay />
                      </span>
                    )}
                    {allDayByDay[idx].length > 0 && (
                      <div className="flex flex-col gap-0.5 pr-5">
                        {allDayByDay[idx].map((ev) => renderPill(ev, day, true))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          {/* end sticky wrapper */}

          <div style={{ display: "grid", gridTemplateColumns: gridCols, height: `${TOTAL_HEIGHT}px` }}>
            {/* Time labels column */}
            <div className="relative select-none border-r">{hourLabels(HOURS, HOUR_START, HOUR_HEIGHT)}</div>

            {/* Day columns */}
            {weekDays.map((day, dayIdx) => {
              const isToday = isSameDay(day, today);
              const dayStr = format(day, "yyyy-MM-dd");
              return (
                <div
                  key={day.toISOString()}
                  data-cal-day={dayStr}
                  className={`relative border-r last:border-r-0 ${isToday ? "bg-primary/[0.02]" : ""}`}
                >
                  {hourLines(HOURS, HOUR_START, HOUR_HEIGHT)}
                  {canWrite && (
                    <CalendarSlotLayer
                      day={dayStr}
                      hourStart={HOUR_START}
                      hourEnd={HOUR_END}
                      hourHeight={HOUR_HEIGHT}
                    />
                  )}
                  {/* Current time indicator (today only) */}
                  {isToday && (
                    <WeekCurrentTimeLine
                      hourStart={HOUR_START}
                      hourEnd={HOUR_END}
                      hourHeight={HOUR_HEIGHT}
                      timeZone={timeZone}
                    />
                  )}
                  {layoutByDay[dayIdx].map((s) =>
                    renderBlock(s, {
                      hourStart: HOUR_START,
                      hourEnd: HOUR_END,
                      hourHeight: HOUR_HEIGHT,
                      minHeight: 20,
                      variant: "week",
                    }),
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  // ── VIEW: Agenda (Day Timeline) ──────────────────────────────────────────────
  /** `phoneOnly`: drawn inside a wrapper that exists below md only — the default week on a phone. */
  const renderAgenda = ({ phoneOnly = false }: { phoneOnly?: boolean } = {}) => {
    const dayStr = baseDateStr;
    const allDayEvents = events.filter((e) => e.allDayEvent && spansDay(e, baseDate));
    const layoutEvents = layOut(
      events.filter((e) => !e.allDayEvent && spansDay(e, baseDate)).map((e) => segmentOn(e, baseDate)),
    );

    const span = hourWindow(layoutEvents);
    const HOUR_START = span.start;
    const HOUR_END = span.end;
    const HOUR_HEIGHT = 64; // px per hour
    const HOURS = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i);
    const TOTAL_HEIGHT = (HOUR_END - HOUR_START) * HOUR_HEIGHT;

    const prevAgendaUrl = calUrl("agenda", format(subDays(baseDate, 1), "yyyy-MM-dd"), currentFilter);
    const nextAgendaUrl = calUrl("agenda", format(addDays(baseDate, 1), "yyyy-MM-dd"), currentFilter);
    const isAgendaToday = isSameDay(baseDate, today);

    /**
     * The day read as a list: all-day items first, then the timed ones in order, the free
     * time between them named when it is an hour or more, and — today — where now falls.
     * The whole of an ordinary day fits on a phone's screen; the grid needed 960px for it.
     */
    const renderDayList = () => {
      const timed = [...layoutEvents].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
      if (allDayEvents.length === 0 && timed.length === 0) {
        return (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
            <CalendarDays className="h-10 w-10 opacity-20" />
            <p className="text-sm">{t("noEventsThisDay")}</p>
            {canWrite && <AppointmentDialog timeZone={timeZone} defaultDate={`${dayStr}T09:00`} />}
          </div>
        );
      }
      const hhmm = (min: number) =>
        `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
      const nowMin = isAgendaToday ? today.getHours() * 60 + today.getMinutes() : null;
      const rows: ReactNode[] = allDayEvents.map((ev) => renderRow(ev, baseDate));
      const nowRow = () => (
        <li
          key="now"
          className="flex items-center gap-2 px-4 py-1"
          aria-label={t("nowAt", { time: hhmm(nowMin ?? 0) })}
        >
          <span className="size-2 shrink-0 rounded-full bg-red-500" aria-hidden />
          <span className="h-px flex-1 bg-red-500/60" aria-hidden />
          <span className="font-medium text-red-600 text-xs tabular-nums dark:text-red-400">
            {t("nowAt", { time: hhmm(nowMin ?? 0) })}
          </span>
        </li>
      );
      let busyUntil: number | null = null;
      let nowPlaced = nowMin === null || timed.length === 0;
      for (const seg of timed) {
        if (busyUntil !== null && seg.startMin - busyUntil >= FREE_GAP_MIN) {
          rows.push(
            <li
              key={`free-${busyUntil}`}
              className="flex items-center gap-3 bg-muted/30 px-4 py-1.5 text-muted-foreground text-xs"
            >
              <span className="w-[5.5rem] shrink-0 tabular-nums">
                {hhmm(busyUntil)} – {hhmm(seg.startMin)}
              </span>
              <span>{t("free")}</span>
            </li>,
          );
        }
        if (!nowPlaced && nowMin !== null && seg.startMin > nowMin) {
          rows.push(nowRow());
          nowPlaced = true;
        }
        rows.push(renderRow(seg.event, baseDate));
        busyUntil = Math.max(busyUntil ?? 0, seg.endMin);
      }
      if (!nowPlaced) rows.push(nowRow());
      return <ul className="divide-y">{rows}</ul>;
    };

    // List or grid: chosen, or — nobody having chosen — the list below md and the grid above,
    // both drawn and CSS picking (src/lib/calendar-day-layout.ts).
    const showList = dayLayout !== "grid";
    // Nobody chose and only a phone will see this: the grid would be drawn for md up inside a
    // wrapper hidden from md up — markup nobody can ever see.
    const showGrid = dayLayout === "grid" || (dayLayout === null && !phoneOnly);
    const layoutHref = (v: DayLayout) => `${dayUrl(baseDate)}&layout=${v}`;
    const layoutToggle = (
      <DayLayoutToggle
        layout={dayLayout}
        hrefs={{ list: layoutHref("list"), grid: layoutHref("grid") }}
        labels={{ list: t("list"), grid: t("grid") }}
        label={t("dayLayoutLabel")}
      />
    );

    return (
      <div className="space-y-2">
        {renderWeekStrip({
          selected: baseDate,
          dayHref: dayUrl,
          prevHref: dayUrl(subWeeks(baseDate, 1)),
          nextHref: dayUrl(addWeeks(baseDate, 1)),
          extra: layoutToggle,
        })}

        {/* Overdue section */}
        {overdueEvents.length > 0 && <CalendarOverdueSection tasks={overdueEvents} />}

        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
          {/* Day header with navigation — from md up; on a phone the strip above
              says which day it is and walks them. */}
          <div
            className={`hidden items-center justify-between border-b px-4 py-3 md:flex ${isAgendaToday ? "bg-primary/5" : "bg-muted/30"}`}
          >
            <div className="flex min-w-0 items-center gap-3">
              <div className={`font-black text-3xl tabular-nums leading-none ${isAgendaToday ? "text-primary" : ""}`}>
                {format(baseDate, "d")}
              </div>
              <div className="min-w-0">
                <div className={`font-semibold text-base capitalize ${isAgendaToday ? "text-primary" : ""}`}>
                  {isAgendaToday ? t("today") : format(baseDate, "EEEE", { locale: dfLocale })}
                </div>
                <div className="text-muted-foreground text-xs capitalize">
                  {format(baseDate, "LLLL yyyy", { locale: dfLocale })}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <div className="mr-2">{layoutToggle}</div>
              <Link
                href={prevAgendaUrl}
                aria-label={t("previousPeriod")}
                className="flex size-11 items-center justify-center rounded-md text-muted-foreground transition-all hover:bg-muted hover:text-foreground sm:size-8"
              >
                <ChevronLeft className="h-4 w-4" />
              </Link>
              <Button variant="outline" size="sm" asChild>
                <Link href={calUrl("agenda", format(today, "yyyy-MM-dd"), currentFilter)}>{t("today")}</Link>
              </Button>
              <Link
                href={nextAgendaUrl}
                aria-label={t("nextPeriod")}
                className="flex size-11 items-center justify-center rounded-md text-muted-foreground transition-all hover:bg-muted hover:text-foreground sm:size-8"
              >
                <ChevronRight className="h-4 w-4" />
              </Link>
            </div>
          </div>

          {/* All-day strip — the grid's; the list carries all-day items as its first rows. */}
          {showGrid && (allDayEvents.length > 0 || canWrite) && (
            <div
              data-cal-day={dayStr}
              className={cn(
                "group items-start gap-3 border-b bg-blue-50/60 px-4 py-2 dark:bg-blue-950/20",
                showList ? "hidden md:flex" : "flex",
              )}
            >
              <div className="w-12 shrink-0 pt-1 text-right font-medium text-[10px] text-muted-foreground uppercase tracking-wider">
                {t("allDay")}
              </div>
              <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                {allDayEvents.map((ev) => (
                  <div key={ev.id} className="min-w-0 max-w-full">
                    {renderPill(ev, baseDate, false)}
                  </div>
                ))}
              </div>
              {canWrite && <NewOnDayButton day={dayStr} allDay />}
            </div>
          )}

          {/* Time grid */}
          {/* ⚠️ On a phone the page scrolls and the grid does not: a scroll area
              inside a scrolling page is two things a thumb has to tell apart.
              From md up the grid keeps its own, with the header in view. */}
          {showGrid && (
            <div
              data-cal-scroll=""
              className={cn(
                "relative md:max-h-[calc(100dvh-290px)] md:min-h-[400px] md:overflow-y-auto",
                showList ? "hidden md:flex" : "flex",
              )}
            >
              <GridAutoScroll
                offsetPx={(openingHour(layoutEvents, isAgendaToday) - HOUR_START) * HOUR_HEIGHT - HOUR_HEIGHT / 2}
                // Only where the grid is what a phone shows: hidden, it has no position to measure.
                pageFallback={dayLayout === "grid"}
                // The sticky week strip, which the hour must land under.
                stickyOffset={112}
              />
              {/* Time labels */}
              <div className="relative w-14 shrink-0 select-none border-r" style={{ height: `${TOTAL_HEIGHT}px` }}>
                {hourLabels(HOURS, HOUR_START, HOUR_HEIGHT)}
              </div>

              {/* Events area */}
              <div data-cal-day={dayStr} className="relative flex-1" style={{ height: `${TOTAL_HEIGHT}px` }}>
                {hourLines(HOURS, HOUR_START, HOUR_HEIGHT)}

                {canWrite && (
                  <CalendarSlotLayer day={dayStr} hourStart={HOUR_START} hourEnd={HOUR_END} hourHeight={HOUR_HEIGHT} />
                )}

                {isAgendaToday && (
                  <WeekCurrentTimeLine
                    hourStart={HOUR_START}
                    hourEnd={HOUR_END}
                    hourHeight={HOUR_HEIGHT}
                    timeZone={timeZone}
                  />
                )}

                {/* Empty state. The slots behind it stay clickable; only its
                  own button takes a click. */}
                {layoutEvents.length === 0 && allDayEvents.length === 0 && (
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                    <CalendarDays className="h-10 w-10 opacity-20" />
                    <p className="text-sm">{t("noEventsThisDay")}</p>
                    {canWrite && (
                      <div className="pointer-events-auto">
                        <AppointmentDialog timeZone={timeZone} defaultDate={`${dayStr}T09:00`} />
                      </div>
                    )}
                  </div>
                )}

                {layoutEvents.map((s) =>
                  renderBlock(s, {
                    hourStart: HOUR_START,
                    hourEnd: HOUR_END,
                    hourHeight: HOUR_HEIGHT,
                    minHeight: 28,
                    variant: "agenda",
                  }),
                )}
              </div>
            </div>
          )}

          {showList && <div className={cn(showGrid && "md:hidden")}>{renderDayList()}</div>}
        </div>
      </div>
    );
  };

  // ── VIEW: List (the days ahead, read top to bottom) ──────────────────────────
  const renderList = () => {
    const days = eachDayOfInterval({ start: startOfDay(baseDate), end: addDays(startOfDay(baseDate), LIST_DAYS - 1) });
    const groups = days
      .map((day) => ({
        day,
        items: events
          .filter((e) => spansDay(e, day))
          .sort((a, b) => Number(b.allDayEvent) - Number(a.allDayEvent) || a.at.getTime() - b.at.getTime()),
      }))
      .filter((g) => g.items.length > 0);

    if (groups.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border bg-card py-16 text-muted-foreground shadow-sm">
          <CalendarDays className="h-10 w-10 opacity-20" />
          <p className="text-sm">{t("listEmpty", { days: LIST_DAYS })}</p>
          {canWrite && <AppointmentDialog timeZone={timeZone} defaultDate={`${baseDateStr}T09:00`} />}
        </div>
      );
    }

    return (
      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        {groups.map(({ day, items }) => {
          const isToday = isSameDay(day, today);
          return (
            <section key={day.toISOString()} className="border-b last:border-b-0">
              <Link
                href={calUrl("agenda", format(day, "yyyy-MM-dd"), currentFilter)}
                className={cn(
                  "flex items-baseline gap-2 bg-muted/40 px-4 py-2 hover:bg-muted/60",
                  isToday && "bg-primary/5",
                )}
              >
                <span className={cn("font-bold text-lg tabular-nums", isToday && "text-primary")}>
                  {format(day, "d")}
                </span>
                <span className="font-medium text-sm capitalize">{format(day, "EEEE", { locale: dfLocale })}</span>
                <span className="text-muted-foreground text-xs capitalize">
                  {format(day, "LLLL yyyy", { locale: dfLocale })}
                </span>
                {isToday && <span className="ml-auto font-medium text-primary text-xs">{t("today")}</span>}
              </Link>
              <ul className="divide-y">{items.map((ev) => renderRow(ev, day))}</ul>
            </section>
          );
        })}
      </div>
    );
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  const VIEW_ICONS = { month: LayoutGrid, week: Columns3, agenda: List, list: Rows3 };
  const VIEW_LABELS = { month: t("month"), week: t("week"), agenda: t("agenda"), list: t("list") };

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      {/* ⚠️ Two rows, deliberately. On a phone the controls used to wrap into
          three or four rows above a grid they are supposed to serve; now the
          title shares its row with the two actions, and the controls sit on one
          scrollable row of their own. */}
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {/* On a phone the top bar already says "Calendar": kept for screen
                readers, not drawn twice. */}
            <h1 className="font-bold text-2xl tracking-tight max-md:sr-only">{t("title")}</h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-sm md:mt-1">
              <span className="flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5" aria-hidden />
                <span className="font-semibold text-foreground">{todayEvents.length}</span> {t("today")}
              </span>
              <span className="text-muted-foreground/40" aria-hidden>
                ·
              </span>
              <span className="flex items-center gap-1.5">
                <Columns3 className="h-3.5 w-3.5" aria-hidden />
                <span className="font-semibold text-foreground">{weekEvents.length}</span> {t("thisWeek")}
              </span>
              {overdueEvents.length > 0 && (
                <>
                  <span className="text-muted-foreground/40" aria-hidden>
                    ·
                  </span>
                  <OverdueTasksPopover tasks={overdueEvents} />
                </>
              )}
              {/* ⚠️ The colour key is reference, not a control, and on a phone it
                  took a whole row above a grid it explains. The dots are on the
                  events themselves; from lg up the key comes back. */}
              <span className="hidden text-muted-foreground/40 lg:inline" aria-hidden>
                ·
              </span>
              {Object.entries(TYPE_STYLES).map(([key, cfg]) => {
                const label =
                  {
                    external: tFeed("externalBusy"),
                    task: t("typeTask"),
                    meeting: t("typeMeeting"),
                    call: t("typeCall"),
                    appointment: t("typeAppointment"),
                  }[key] ?? key;
                if (key === "external" && externalEvents.length === 0) return null;
                return (
                  <span key={key} className="hidden items-center gap-1.5 lg:flex">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${cfg.dot}`} aria-hidden />
                    {label}
                  </span>
                );
              })}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="md:hidden">
              <CalendarFilterMenu
                label={t("filterLabel")}
                options={(["all", "mine", "group"] as CalendarFilter[]).map((f) => ({
                  value: f,
                  label: { all: t("filterAll"), mine: t("filterMine"), group: t("filterGroup") }[f],
                  href: calUrl(currentView, baseDateStr, f),
                  active: currentFilter === f,
                }))}
              />
            </div>
            <SubscribeDialog />
            {canWrite && (
              <AppointmentDialog
                timeZone={timeZone}
                defaultDate={dateParam ? `${baseDateStr}T09:00` : undefined}
                openOnNew
                // The bottom bar's Create offers a new appointment first on this page.
                triggerClassName="max-md:hidden"
              />
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* View toggle: the full width on a phone, four equal segments. */}
          <nav
            aria-label={t("viewLabel")}
            className="grid w-full grid-cols-4 rounded-lg border bg-muted/40 p-0.5 sm:flex sm:w-auto"
          >
            {VIEWS.map((v) => {
              const Icon = VIEW_ICONS[v];
              const isActive = currentView === v;
              // When the week is a default, the switch has to say what is on
              // screen: agenda below md, week above it.
              const activeClass = "bg-background text-foreground shadow-sm";
              const idleClass = "text-muted-foreground hover:text-foreground";
              const state = !weekIsADefault
                ? isActive
                  ? activeClass
                  : idleClass
                : v === "week"
                  ? `${idleClass} md:${activeClass.split(" ").join(" md:")}`
                  : v === "agenda"
                    ? `${activeClass} md:bg-transparent md:text-muted-foreground md:shadow-none`
                    : idleClass;
              return (
                <Link
                  key={v}
                  href={calUrl(v, baseDateStr, currentFilter)}
                  aria-current={isActive && !weekIsADefault ? "page" : undefined}
                  className={`flex min-h-9 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 font-medium text-xs transition-all sm:px-3 ${state}`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{VIEW_LABELS[v]}</span>
                </Link>
              );
            })}
          </nav>

          {/* Filter toggle */}
          <nav aria-label={t("filterLabel")} className="hidden shrink-0 rounded-lg border bg-muted/40 p-0.5 md:flex">
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
                  href={calUrl(currentView, baseDateStr, f)}
                  aria-current={isActive ? "true" : undefined}
                  className={`flex min-h-9 items-center rounded-md px-3 py-1.5 font-medium text-xs transition-all ${
                    isActive ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {LABELS[f]}
                </Link>
              );
            })}
          </nav>

          {/* Navigation */}
          {/* The agenda walks its own days, so the week's range walker would be a
              second, differently-scoped navigation next to it. Hidden below md
              exactly when the agenda is the thing on screen. */}
          {currentView !== "agenda" && (
            <div
              className={cn(
                "flex items-center gap-2 sm:ml-auto",
                (weekIsADefault || currentView === "week") && "hidden md:flex",
              )}
            >
              <div className="flex items-center gap-1 rounded-lg border bg-muted/40 p-0.5">
                <Link
                  href={prevUrl}
                  aria-label={t("previousPeriod")}
                  className="flex size-9 items-center justify-center rounded-md text-muted-foreground transition-all hover:bg-background hover:text-foreground sm:size-8"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Link>
                <span
                  aria-live="polite"
                  className="px-1 text-center font-semibold text-sm capitalize sm:min-w-[148px] sm:px-2"
                >
                  {periodTitle}
                </span>
                <Link
                  href={nextUrl}
                  aria-label={t("nextPeriod")}
                  className="flex size-9 items-center justify-center rounded-md text-muted-foreground transition-all hover:bg-background hover:text-foreground sm:size-8"
                >
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </div>
              <Button variant="outline" size="sm" asChild className="h-9 sm:h-8">
                <Link href={todayUrl}>{t("today")}</Link>
              </Button>
            </div>
          )}
        </div>
        {canWrite && <p className="hidden text-muted-foreground/80 text-xs md:block">{t("dragHint")}</p>}
      </div>

      {/* ── Calendar view ── */}
      <div>
        <SwipeNav prevHref={swipePrev} nextHref={swipeNext}>
          {currentView === "month" && renderMonth()}
          {currentView === "week" &&
            (weekIsADefault ? (
              <>
                <div className="md:hidden">{renderAgenda({ phoneOnly: true })}</div>
                <div className="hidden md:block">{renderWeek()}</div>
              </>
            ) : (
              <>
                {renderWeekPhone()}
                <div className="hidden md:block">{renderWeek()}</div>
              </>
            ))}
          {currentView === "agenda" && renderAgenda()}
          {currentView === "list" && renderList()}
        </SwipeNav>
      </div>

      {/* ── Appointment detail sheet ── */}
      <AppointmentDetailSheet canWrite={canWrite} canDelete={canDelete} timeZone={timeZone} />
    </div>
  );
}
