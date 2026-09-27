"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { CalendarCheck, CalendarDays, CheckSquare, Loader2, PhoneCall, Repeat, Users } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";

import { type RecurrenceScope, updateAppointment } from "@/actions/appointments";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { addDaysToDate, addMinutesToWall, fromWallValue, wallDiffMinutes } from "@/lib/wall-clock";

import { useInviteToast } from "./appointment-dialog";
import { onAppointmentLinkClick } from "./calendar-selection";
import { ScopeChoice } from "./scope-choice";

const ICONS = {
  appointment: CalendarCheck,
  meeting: Users,
  call: PhoneCall,
  external: CalendarDays,
  task: CheckSquare,
} as const;

export function EventIcon({ type, className }: { type: string; className?: string }) {
  const Icon = ICONS[type as keyof typeof ICONS] ?? CheckSquare;
  return <Icon className={className} />;
}

const SNAP = 15;
const pad = (n: number) => String(n).padStart(2, "0");
const wallAt = (day: string, minutes: number) => addMinutesToWall(`${day}T00:00`, minutes);
const hhmm = (minutes: number) => `${pad(Math.floor((minutes % 1440) / 60))}:${pad(minutes % 60)}`;

/** What an appointment needs to be moved by hand. Absent for anything else. */
export interface DragInfo {
  appointmentId: string;
  occurrence: string | null;
  recurring: boolean;
  hasInvitees: boolean;
  allDay: boolean;
  /** Where it starts on the workspace's clock, and how long it lasts. */
  startWall: string;
  durationMin: number;
  timeZone: string;
}

type Pending = { startWall: string; endWall: string };

/**
 * Saves a new time for an appointment, asking first when somebody else is
 * affected: the invitees (should they be told?) or the rest of a series (this
 * one, or all of them?). Moving a private appointment asks nothing.
 */
function useReschedule(drag: DragInfo | undefined, onSettled: () => void) {
  const t = useTranslations("appointment");
  const locale = useLocale();
  const describe = (wall: string) => {
    const at = drag ? fromWallValue(wall, drag.timeZone) : null;
    if (!at || !drag) return wall;
    return new Intl.DateTimeFormat(locale, {
      weekday: "long",
      day: "numeric",
      month: "long",
      ...(drag.allDay ? {} : { hour: "2-digit", minute: "2-digit" }),
      timeZone: drag.timeZone,
    }).format(at);
  };
  const router = useRouter();
  const inviteToast = useInviteToast();
  const [pending, setPending] = useState<Pending | null>(null);
  const [scope, setScope] = useState<RecurrenceScope>("this");
  const [notify, setNotify] = useState(true);
  const [saving, startSaving] = useTransition();

  const save = (p: Pending, chosenScope: RecurrenceScope, notifyAttendees: boolean) => {
    if (!drag) return;
    const tz = drag.timeZone;
    const startAt = fromWallValue(p.startWall, tz);
    const endAt = fromWallValue(p.endWall, tz);
    if (!startAt || !endAt || endAt <= startAt) return onSettled();
    startSaving(async () => {
      try {
        const { inviteStatus } = await updateAppointment(
          drag.appointmentId,
          { startAt, endAt, notifyAttendees },
          drag.recurring && drag.occurrence ? { scope: chosenScope, occurrence: drag.occurrence } : undefined,
        );
        toast.success(t("drag.moved"));
        if (notifyAttendees && drag.hasInvitees) inviteToast(inviteStatus);
        setPending(null);
        router.refresh();
      } catch {
        toast.error(t("errorUpdate"));
        setPending(null);
        onSettled();
      }
    });
  };

  const request = (p: Pending) => {
    if (!drag) return;
    if (drag.recurring || drag.hasInvitees) {
      setScope("this");
      setNotify(true);
      setPending(p);
    } else {
      save(p, "all", false);
    }
  };

  const dialog = (
    <AlertDialog
      open={pending !== null && !saving}
      onOpenChange={(v) => {
        if (!v) {
          setPending(null);
          onSettled();
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("drag.confirmTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {pending && drag
              ? t("drag.confirmBody", { from: describe(drag.startWall), to: describe(pending.startWall) })
              : null}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {drag?.recurring && <ScopeChoice value={scope} onChange={setScope} />}
        {drag?.hasInvitees && (
          <label htmlFor="drag-notify" className="flex cursor-pointer items-start gap-2 text-sm">
            <Checkbox
              id="drag-notify"
              checked={notify}
              onCheckedChange={(v) => setNotify(v === true)}
              className="mt-0.5"
            />
            <span>{t("dialog.notifyUpdate")}</span>
          </label>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>{t("detail.confirmBack")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              if (pending) save(pending, scope, notify && Boolean(drag?.hasInvitees));
            }}
          >
            {t("drag.confirmYes")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { request, dialog, saving };
}

/** The day column or cell under the pointer: anything marked `data-cal-day`. */
function dayUnder(x: number, y: number): HTMLElement | null {
  for (const el of document.elementsFromPoint(x, y)) {
    if (el instanceof HTMLElement && el.dataset.calDay) return el;
  }
  return null;
}

// ─── Blocks in a time grid (week, day) ───────────────────────────────────────

export interface TimedBlockProps {
  /** None for busy time read from another calendar: there is nothing to open. */
  href: string | null;
  title: string;
  type: string;
  pillClass: string;
  timeLabel: string;
  entityLabel?: string | null;
  top: number;
  height: number;
  leftPct: number;
  widthPct: number;
  variant: "week" | "agenda";
  muted?: boolean;
  recurring?: boolean;
  /** Minutes past midnight this block covers on its day. */
  startMin: number;
  endMin: number;
  hourHeight: number;
  drag?: DragInfo;
}

/**
 * One event in a time grid. An appointment can be dragged to another time or
 * day, and stretched from its lower edge; everything else is a link.
 *
 * ⚠️ Mouse and pen only. A finger on a phone is scrolling the grid, and a grid
 * that moves meetings when somebody scrolls past them is worse than one that
 * cannot move them at all: a tap still opens it, and the form changes the time.
 */
export function TimedEventBlock(props: TimedBlockProps) {
  const t = useTranslations("appointment");
  const { drag, hourHeight } = props;
  const origin = useRef<{ x: number; y: number; mode: "move" | "resize"; col: HTMLElement | null } | null>(null);
  const moved = useRef(false);
  const [preview, setPreview] = useState<{
    dx: number;
    dy: number;
    dh: number;
    label: string;
    pending: Pending;
  } | null>(null);
  const { request, dialog, saving } = useReschedule(drag, () => setPreview(null));

  // New props from the server mean the move landed: the preview has done its job.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on a new position only
  useEffect(() => setPreview(null), [props.top, props.height, props.startMin, drag?.startWall]);

  // Only a block that starts and ends on its own day can be dragged by its edges.
  const movable = Boolean(drag) && !drag?.allDay && props.startMin >= 0 && props.endMin <= 1440;

  const onPointerDown = (e: React.PointerEvent<HTMLAnchorElement>) => {
    if (!movable || e.pointerType === "touch" || e.button !== 0 || saving) return;
    const mode = (e.target as HTMLElement).dataset.resize ? "resize" : "move";
    origin.current = { x: e.clientX, y: e.clientY, mode, col: e.currentTarget.closest<HTMLElement>("[data-cal-day]") };
    moved.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLAnchorElement>) => {
    const o = origin.current;
    if (!o || !drag) return;
    if (!moved.current && Math.hypot(e.clientX - o.x, e.clientY - o.y) < 4) return;
    moved.current = true;
    const delta = Math.round((((e.clientY - o.y) / hourHeight) * 60) / SNAP) * SNAP;

    if (o.mode === "resize") {
      const endMin = Math.min(1440, Math.max(props.startMin + SNAP, props.endMin + delta));
      const day = drag.startWall.slice(0, 10);
      setPreview({
        dx: 0,
        dy: 0,
        dh: ((endMin - props.endMin) / 60) * hourHeight,
        label: `${hhmm(props.startMin)} – ${hhmm(endMin)}`,
        pending: { startWall: drag.startWall, endWall: wallAt(day, endMin) },
      });
      return;
    }

    const target = dayUnder(e.clientX, e.clientY);
    const targetDay = target?.dataset.calDay ?? o.col?.dataset.calDay ?? drag.startWall.slice(0, 10);
    const dx = target && o.col ? target.getBoundingClientRect().left - o.col.getBoundingClientRect().left : 0;
    const startMin = Math.min(1440 - SNAP, Math.max(0, props.startMin + delta));
    const startWall = wallAt(targetDay, startMin);
    setPreview({
      dx,
      dy: ((startMin - props.startMin) / 60) * hourHeight,
      dh: 0,
      label: `${hhmm(startMin)} – ${hhmm(startMin + drag.durationMin)}`,
      pending: { startWall, endWall: addMinutesToWall(startWall, drag.durationMin) },
    });
  };

  const onPointerUp = (e: React.PointerEvent<HTMLAnchorElement>) => {
    const o = origin.current;
    origin.current = null;
    if (!o || !moved.current) return;
    e.preventDefault();
    const p = preview?.pending;
    if (!p || (p.startWall === drag?.startWall && p.endWall === addMinutesToWall(drag.startWall, drag.durationMin))) {
      setPreview(null);
      return;
    }
    request(p);
  };

  const isWeek = props.variant === "week";
  const height = props.height + (preview?.dh ?? 0);
  const box = {
    top: `${props.top}px`,
    height: `${height}px`,
    left: `${props.leftPct}%`,
    width: `${props.widthPct}%`,
  };

  if (!props.href) {
    return (
      <div
        title={props.title}
        className={cn("absolute z-10 select-none", isWeek ? "px-0.5 py-0.5" : "px-1 py-0.5")}
        style={box}
      >
        <div
          className={cn(
            "flex h-full flex-col overflow-hidden rounded-[3px]",
            isWeek ? "border-l-2 px-1 py-0.5 text-xs" : "border-l-[3px] px-2 py-1",
            props.pillClass,
          )}
        >
          <div className={cn("flex items-center font-semibold leading-tight", isWeek ? "gap-0.5" : "gap-1 text-xs")}>
            <EventIcon type={props.type} className={isWeek ? "h-2.5 w-2.5 shrink-0" : "h-3 w-3 shrink-0"} />
            <span className={cn("truncate", isWeek && "text-[11px]")}>{props.title}</span>
          </div>
          {height >= (isWeek ? 36 : 44) && (
            <div className="truncate text-[10px] leading-tight opacity-70">{props.timeLabel}</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <Link
        href={props.href}
        scroll={false}
        draggable={false}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          origin.current = null;
          setPreview(null);
        }}
        onClickCapture={(e) => {
          // The click that ends a drag is not a click on the event.
          if (moved.current) {
            e.preventDefault();
            e.stopPropagation();
            moved.current = false;
          }
        }}
        onClick={(e) => onAppointmentLinkClick(e, props.href as string)}
        data-appointment-link=""
        // Everything a sighted reader gets from the block, in one sentence.
        aria-label={[props.title, props.timeLabel, props.entityLabel].filter(Boolean).join(", ")}
        title={props.entityLabel ? `${props.title} — ${props.entityLabel}` : props.title}
        className={cn(
          "absolute z-10 select-none rounded-[4px] outline-none focus-visible:z-30 focus-visible:ring-2 focus-visible:ring-ring",
          isWeek ? "px-0.5 py-0.5" : "px-1 py-0.5",
          movable && "cursor-grab active:cursor-grabbing",
          preview && "z-30",
        )}
        style={{ ...box, transform: preview ? `translate(${preview.dx}px, ${preview.dy}px)` : undefined }}
      >
        <div
          className={cn(
            "relative flex h-full flex-col overflow-hidden rounded-[3px] transition-opacity hover:opacity-80",
            isWeek ? "border-l-2 px-1 py-0.5 text-xs" : "border-l-[3px] px-2 py-1",
            props.pillClass,
            props.muted && "opacity-60",
            preview && "opacity-90 shadow-lg ring-2 ring-primary/40",
          )}
        >
          <div
            className={cn(
              "flex items-center font-semibold leading-tight",
              isWeek ? "gap-0.5" : "gap-1 text-xs",
              props.muted && "line-through",
            )}
          >
            <EventIcon type={props.type} className={isWeek ? "h-2.5 w-2.5 shrink-0" : "h-3 w-3 shrink-0"} />
            <span className={cn("truncate", isWeek && "text-[11px]")}>{props.title}</span>
            {props.recurring && (
              <Repeat className="h-2.5 w-2.5 shrink-0 opacity-60" aria-label={t("recurrence.label")} />
            )}
          </div>
          {height >= (isWeek ? 36 : 44) && (
            <div className={cn("truncate text-[10px] leading-tight", isWeek ? "opacity-70" : "mt-0.5 opacity-75")}>
              {preview ? preview.label : props.timeLabel}
            </div>
          )}
          {height >= (isWeek ? 52 : 60) && props.entityLabel && (
            <div className={cn("truncate text-[10px] leading-tight", isWeek ? "opacity-60" : "mt-0.5 opacity-65")}>
              {props.entityLabel}
            </div>
          )}
          {saving && <Loader2 className="absolute top-1 right-1 h-3 w-3 animate-spin" />}
          {movable && (
            <span data-resize="1" aria-hidden className="absolute right-0 bottom-0 left-0 h-1.5 cursor-ns-resize" />
          )}
        </div>
      </Link>
      {dialog}
    </>
  );
}

// ─── Pills that move between days (month, all-day strip) ─────────────────────

/**
 * An appointment pill that can be dropped on another day, keeping its time — or,
 * for an all-day one, its length in days.
 */
export function DayMovablePill({
  href,
  title,
  type,
  pillClass,
  timeLabel,
  entityLabel,
  muted,
  recurring,
  drag,
}: {
  href: string;
  title: string;
  type: string;
  pillClass: string;
  timeLabel?: string | null;
  entityLabel?: string | null;
  muted?: boolean;
  recurring?: boolean;
  drag?: DragInfo;
}) {
  const t = useTranslations("appointment");
  const origin = useRef<{ x: number; y: number; day: string } | null>(null);
  const moved = useRef(false);
  const [offset, setOffset] = useState<{ dx: number; dy: number; day: string } | null>(null);
  const { request, dialog, saving } = useReschedule(drag, () => setOffset(null));

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on a new position only
  useEffect(() => setOffset(null), [drag?.startWall]);

  const onPointerDown = (e: React.PointerEvent<HTMLAnchorElement>) => {
    if (!drag || e.pointerType === "touch" || e.button !== 0 || saving) return;
    const day = e.currentTarget.closest<HTMLElement>("[data-cal-day]")?.dataset.calDay;
    if (!day) return;
    origin.current = { x: e.clientX, y: e.clientY, day };
    moved.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLAnchorElement>) => {
    const o = origin.current;
    if (!o) return;
    if (!moved.current && Math.hypot(e.clientX - o.x, e.clientY - o.y) < 4) return;
    moved.current = true;
    const target = dayUnder(e.clientX, e.clientY);
    setOffset({ dx: e.clientX - o.x, dy: e.clientY - o.y, day: target?.dataset.calDay ?? o.day });
  };

  const onPointerUp = (e: React.PointerEvent<HTMLAnchorElement>) => {
    const o = origin.current;
    origin.current = null;
    if (!o || !moved.current || !drag) return;
    e.preventDefault();
    const targetDay = offset?.day ?? o.day;
    const days = wallDiffMinutes(`${o.day}T00:00`, `${targetDay}T00:00`) / 1440;
    if (!days) return setOffset(null);
    const startWall = `${addDaysToDate(drag.startWall.slice(0, 10), days)}T${drag.startWall.slice(11, 16) || "00:00"}`;
    request({ startWall, endWall: addMinutesToWall(startWall, drag.durationMin) });
  };

  return (
    <>
      <Link
        href={href}
        scroll={false}
        draggable={false}
        title={entityLabel ? `${title} — ${entityLabel}` : title}
        aria-label={[title, timeLabel, entityLabel].filter(Boolean).join(", ")}
        data-appointment-link=""
        onClick={(e) => onAppointmentLinkClick(e, href)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          origin.current = null;
          setOffset(null);
        }}
        onClickCapture={(e) => {
          if (moved.current) {
            e.preventDefault();
            e.stopPropagation();
            moved.current = false;
          }
        }}
        className={cn(
          "relative block select-none rounded outline-none focus-visible:ring-2 focus-visible:ring-ring",
          drag && "cursor-grab active:cursor-grabbing",
          offset && "z-30",
        )}
        style={offset ? { transform: `translate(${offset.dx}px, ${offset.dy}px)` } : undefined}
      >
        <div
          className={cn(
            "flex items-center gap-1.5 rounded border-l-[3px] px-1.5 py-1 text-xs leading-tight transition-opacity hover:opacity-80",
            pillClass,
            muted && "opacity-60",
            offset && "opacity-90 shadow-lg ring-2 ring-primary/40",
          )}
        >
          <EventIcon type={type} className="h-3 w-3 shrink-0" />
          {timeLabel && <span className="shrink-0 font-semibold tabular-nums opacity-70">{timeLabel}</span>}
          <span className={cn("truncate font-medium", muted && "line-through")}>{title}</span>
          {recurring && <Repeat className="h-2.5 w-2.5 shrink-0 opacity-60" aria-label={t("recurrence.label")} />}
          {saving && <Loader2 className="ml-auto h-3 w-3 shrink-0 animate-spin" />}
        </div>
      </Link>
      {dialog}
    </>
  );
}
