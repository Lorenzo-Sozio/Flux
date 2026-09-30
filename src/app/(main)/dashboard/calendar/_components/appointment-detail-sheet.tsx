"use client";

import { useCallback, useEffect, useState, useTransition } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  Bell,
  BellOff,
  CheckCircle2,
  Copy,
  CopyPlus,
  Download,
  ExternalLink,
  FileText,
  HelpCircle,
  Link2,
  Loader2,
  MapPin,
  MoreHorizontal,
  Pencil,
  Repeat,
  RotateCcw,
  Send,
  Timer,
  Trash2,
  Undo2,
  Users,
  Video,
  X,
  XCircle,
} from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";

import {
  cancelAppointment,
  deleteAppointment,
  getAppointmentById,
  type InviteResult,
  type OccurrenceTarget,
  type RecurrenceScope,
  resendInvitations,
  restoreAppointment,
  setAppointmentCompleted,
  setAttendeeStatus,
} from "@/actions/appointments";
import { AiBriefing } from "@/components/crm/ai/ai-briefing";
import { RecordVisit } from "@/components/crm/record-visit";
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
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import type { AiEntry } from "@/lib/ai/types";
import { entityHref } from "@/lib/entities";
import { parseRRule } from "@/lib/recurrence";
import { describeRecurrence } from "@/lib/recurrence-text";
import { cn } from "@/lib/utils";
import { toWallDate } from "@/lib/wall-clock";

import { type AppointmentDetail, AppointmentForm, draftFromAppointment, useInviteToast } from "./appointment-dialog";
import { durationLabel, reminderLabel } from "./appointment-format";
import { closeAppointment, forgetOpenedEntry, useSelectedAppointment } from "./calendar-selection";
import { ScopeChoice } from "./scope-choice";

const RSVP = {
  accepted: { icon: CheckCircle2, color: "text-green-600 dark:text-green-400", bar: "bg-green-500" },
  tentative: { icon: HelpCircle, color: "text-amber-600 dark:text-amber-400", bar: "bg-amber-400" },
  declined: { icon: XCircle, color: "text-red-600 dark:text-red-400", bar: "bg-red-500" },
  pending: { icon: Timer, color: "text-muted-foreground", bar: "bg-muted-foreground/30" },
} as const;

type RsvpStatus = keyof typeof RSVP;
const RSVP_ORDER: RsvpStatus[] = ["accepted", "tentative", "declined", "pending"];

const STATUS_CHIP = {
  completed: "bg-green-100 text-green-800 dark:bg-green-950/60 dark:text-green-200",
  cancelled: "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-200",
} as const;

type Confirm = "cancel" | "delete" | null;
type Mode = { kind: "view" } | { kind: "edit"; target?: OccurrenceTarget } | { kind: "duplicate" };

/** A location that is itself an address on the web opens as one; any other goes to a map. */
function locationHref(location: string, locationUrl: string | null): string {
  if (locationUrl) return locationUrl;
  if (/^https?:\/\//i.test(location)) return location;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
}

function Row({ icon: Icon, label, children }: { icon: typeof Bell; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 text-sm">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <span className="sr-only">{label}: </span>
        {children}
      </div>
    </div>
  );
}

function ToolbarIcon({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-9 shrink-0"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      {children}
    </Button>
  );
}

/**
 * The appointment the URL names, in a panel beside the calendar.
 *
 * ⚠️ Not modal on a desktop. The calendar stays visible and live behind it, so
 * clicking another appointment switches the panel instead of closing it — which
 * is how people compare two meetings or walk through a day. A click anywhere
 * else closes it, as before; while a form is open nothing outside does, because
 * a stray click is not a reason to lose an edit.
 *
 * On a phone it fills the screen, inset from the notch and the home indicator,
 * and the back button closes it (the panel is an entry in the history).
 */
export function AppointmentDetailSheet({
  canWrite,
  canDelete,
  timeZone,
  aiBriefing,
}: {
  /** Offer the copilot's briefing for an appointment linked to a record (Fase 5, C3). */
  aiBriefing?: AiEntry;
  canWrite: boolean;
  canDelete: boolean;
  /** The workspace's zone: every time here is shown on its clock. */
  timeZone: string;
}) {
  const t = useTranslations("appointment");
  const tc = useTranslations("common");
  const te = useTranslations("entities.types");
  const formatter = useFormatter();
  const locale = useLocale();
  const router = useRouter();
  const inviteToast = useInviteToast();
  const { id: appointmentId, occurrence } = useSelectedAppointment();

  const [appt, setAppt] = useState<AppointmentDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [missing, setMissing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [mode, setMode] = useState<Mode>({ kind: "view" });
  const [askScopeForEdit, setAskScopeForEdit] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [notifyOnRemove, setNotifyOnRemove] = useState(true);
  const [scope, setScope] = useState<RecurrenceScope>("this");

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setMissing(false);
    try {
      const row = await getAppointmentById(id);
      setAppt(row);
      setMissing(row === null);
    } catch {
      setAppt(null);
      setMissing(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setMode({ kind: "view" });
    if (!appointmentId) {
      forgetOpenedEntry();
      return;
    }
    // Another appointment: never show the previous one's details under its title.
    setAppt((current) => (current?.id === appointmentId ? current : null));
    load(appointmentId);
  }, [appointmentId, load]);

  const close = () => {
    setMode({ kind: "view" });
    closeAppointment();
  };

  const reportNotices = (inviteStatus: InviteResult) => {
    if (inviteStatus.noProvider) {
      toast.warning(t("detail.noProvider"), { duration: 6000 });
    } else if (inviteStatus.sent > 0 && inviteStatus.failed === 0) {
      toast.success(t("detail.notificationsSent", { count: inviteStatus.sent }));
    } else if (inviteStatus.sent > 0 && inviteStatus.failed > 0) {
      toast.warning(t("detail.notificationsPartial", { sent: inviteStatus.sent, failed: inviteStatus.failed }), {
        duration: 6000,
      });
    } else if (inviteStatus.failed > 0) {
      toast.error(t("detail.notificationsFailed", { count: inviteStatus.failed }), { duration: 6000 });
    }
  };

  const shown = appt && appt.id === appointmentId ? appt : null;
  const rule = parseRRule(shown?.recurrenceRule);
  const recurring = Boolean(rule);
  // The occurrence shown: the one clicked, or the appointment itself.
  const occurrenceDate = recurring && occurrence ? new Date(occurrence) : null;
  const start = shown ? (occurrenceDate ?? new Date(shown.startAt)) : null;
  const end =
    shown && start
      ? new Date(start.getTime() + (new Date(shown.endAt).getTime() - new Date(shown.startAt).getTime()))
      : null;
  const target: OccurrenceTarget | undefined =
    recurring && start ? { scope, occurrence: start.toISOString() } : undefined;

  const organizerRow = shown?.attendees.find((a) => a.role === "organizer") ?? null;
  const invitees = shown?.attendees.filter((a) => a.role !== "organizer") ?? [];
  const hasInvitees = invitees.length > 0;
  const isUpcoming = !!end && (recurring || end > new Date());
  const cancelled = shown?.status === "cancelled";

  const after = (inviteStatus: InviteResult | undefined, message: string, notified: boolean) => {
    toast.success(message);
    if (notified && inviteStatus) reportNotices(inviteStatus);
    setConfirm(null);
    close();
    router.refresh();
  };

  const handleCancel = () => {
    if (!shown) return;
    startTransition(async () => {
      try {
        const { inviteStatus } = await cancelAppointment(shown.id, { notifyAttendees: notifyOnRemove, target });
        after(
          inviteStatus,
          recurring && scope !== "all" ? t("detail.occurrencesRemoved") : t("detail.cancelled"),
          notifyOnRemove,
        );
      } catch {
        toast.error(t("detail.cancelError"));
      }
    });
  };

  const handleDelete = () => {
    if (!shown) return;
    startTransition(async () => {
      try {
        const { inviteStatus } = await deleteAppointment(shown.id, { notifyAttendees: notifyOnRemove, target });
        after(
          inviteStatus,
          recurring && scope !== "all" ? t("detail.occurrencesRemoved") : t("deleteSuccess"),
          notifyOnRemove,
        );
      } catch {
        toast.error(t("detail.deleteError"));
      }
    });
  };

  const run = (action: () => Promise<unknown>, success: string) => {
    if (!shown) return;
    startTransition(async () => {
      try {
        const result = await action();
        toast.success(success);
        const inviteStatus = (result as { inviteStatus?: InviteResult } | undefined)?.inviteStatus;
        if (inviteStatus) inviteToast(inviteStatus);
        await load(shown.id);
        router.refresh();
      } catch {
        toast.error(t("errorUpdate"));
      }
    });
  };

  const copyLink = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t("detail.linkCopied"));
    } catch {
      toast.error(t("detail.copyFailed"));
    }
  };

  const openEditor = () => {
    if (recurring) {
      setScope("this");
      setAskScopeForEdit(true);
    } else {
      setMode({ kind: "edit" });
    }
  };

  const openConfirm = (kind: Exclude<Confirm, null>) => {
    setNotifyOnRemove(true);
    setScope("this");
    setConfirm(kind);
  };

  const tally = RSVP_ORDER.map((s) => ({
    status: s,
    count: invitees.filter((a) => (a.status ?? "pending") === s).length,
  }));

  const tz = { timeZone };
  const lastDay = shown?.allDay && end ? new Date(end.getTime() - 60_000) : end;
  const sameDay = start && lastDay && toWallDate(start, timeZone) === toWallDate(lastDay, timeZone);
  const editing = mode.kind !== "view";

  // ── What the panel says about when ──────────────────────────────────────────
  let dateLine = "";
  let timeLine = "";
  if (shown && start && end && lastDay) {
    if (shown.allDay) {
      dateLine = sameDay
        ? formatter.dateTime(start, { weekday: "long", day: "numeric", month: "long", year: "numeric", ...tz })
        : `${formatter.dateTime(start, { day: "numeric", month: "long", ...tz })} – ${formatter.dateTime(lastDay, { day: "numeric", month: "long", year: "numeric", ...tz })}`;
      timeLine = t("fields.allDay");
    } else {
      dateLine = formatter.dateTime(start, { weekday: "long", day: "numeric", month: "long", year: "numeric", ...tz });
      const from = formatter.dateTime(start, { hour: "2-digit", minute: "2-digit", ...tz });
      const until = sameDay
        ? formatter.dateTime(end, { hour: "2-digit", minute: "2-digit", ...tz })
        : formatter.dateTime(end, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", ...tz });
      timeLine = `${from} – ${until} · ${durationLabel(t, (end.getTime() - start.getTime()) / 60_000)}`;
    }
  }

  const person = (a: AppointmentDetail["attendees"][number], isOrganizer: boolean) => {
    const status = (a.status in RSVP ? a.status : "pending") as RsvpStatus;
    const cfg = RSVP[status];
    const Icon = cfg.icon;
    const answeredAt = a.responseAt
      ? formatter.dateTime(new Date(a.responseAt), {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
          ...tz,
        })
      : undefined;
    const badge = (
      <span className={cn("flex items-center gap-1 font-medium text-xs", cfg.color)}>
        <Icon className="h-3.5 w-3.5" aria-hidden />
        {t(`rsvp.${status}`)}
      </span>
    );
    return (
      <li key={a.id} className="flex min-h-12 items-center gap-3 py-1.5">
        <div
          className="relative flex size-9 shrink-0 items-center justify-center rounded-full bg-muted font-semibold text-sm"
          aria-hidden
        >
          {a.name.charAt(0).toUpperCase()}
          <span className={cn("-right-0.5 -bottom-0.5 absolute size-3 rounded-full ring-2 ring-background", cfg.bar)} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-medium text-sm">{a.name}</span>
            {isOrganizer && (
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {t("detail.organizer")}
              </span>
            )}
            {!isOrganizer && a.role === "optional" && (
              <span className="shrink-0 text-[10px] text-muted-foreground italic">{t("fields.roleOptional")}</span>
            )}
          </div>
          <a
            href={`mailto:${a.email}`}
            className="block truncate text-muted-foreground text-xs underline-offset-2 hover:text-foreground hover:underline"
          >
            {a.email}
          </a>
        </div>
        {isOrganizer ? null : canWrite && !cancelled ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              className="-mr-1 flex min-h-9 items-center rounded-md px-2 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title={answeredAt ?? t("detail.setAnswer")}
              aria-label={`${t("detail.setAnswerFor", { name: a.name })}: ${t(`rsvp.${status}`)}`}
            >
              {badge}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {RSVP_ORDER.map((s) => {
                const SIcon = RSVP[s].icon;
                return (
                  <DropdownMenuItem
                    key={s}
                    disabled={s === status}
                    onSelect={() => run(() => setAttendeeStatus(a.id, s), t("detail.answerSaved"))}
                  >
                    <SIcon className={cn("h-4 w-4", RSVP[s].color)} />
                    {t(`rsvp.${s}`)}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <span title={answeredAt}>{badge}</span>
        )}
      </li>
    );
  };

  return (
    <>
      <Sheet
        open={!!appointmentId}
        modal={false}
        onOpenChange={(v) => {
          if (!v) close();
        }}
      >
        <SheetContent
          side="right"
          showCloseButton={false}
          onInteractOutside={(e) => {
            const el = e.target as HTMLElement | null;
            // Another appointment switches the panel; a toast is not "elsewhere";
            // and nothing outside may throw away an open form.
            if (editing || el?.closest("[data-appointment-link],[data-sonner-toaster]")) e.preventDefault();
          }}
          onEscapeKeyDown={(e) => {
            if (editing) e.preventDefault();
          }}
          className="gap-0 border-l p-0 pt-[var(--safe-top)] pb-[var(--safe-bottom)] shadow-2xl data-[side=right]:w-full data-[side=right]:sm:max-w-[460px]"
        >
          {shown && <RecordVisit type="appointment" id={shown.id} label={shown.title} />}

          {/* ── Toolbar ─────────────────────────────────────────────────────── */}
          <div className="flex h-14 shrink-0 items-center gap-1 border-b px-2 sm:px-3">
            {editing ? (
              <>
                <ToolbarIcon label={t("detail.back")} onClick={() => setMode({ kind: "view" })}>
                  <ArrowLeft className="h-4 w-4" />
                </ToolbarIcon>
                <SheetTitle className="min-w-0 flex-1 truncate font-semibold text-base">
                  {mode.kind === "duplicate" ? t("dialog.duplicateTitle") : t("edit")}
                </SheetTitle>
              </>
            ) : (
              <>
                {shown && canWrite && !cancelled && (
                  <Button size="sm" className="h-9 gap-1.5" onClick={openEditor} disabled={isPending}>
                    <Pencil className="h-3.5 w-3.5" />
                    {t("detail.edit")}
                  </Button>
                )}
                {shown && canWrite && cancelled && (
                  <Button
                    size="sm"
                    className="h-9 gap-1.5"
                    onClick={() => run(() => restoreAppointment(shown.id), t("detail.restored"))}
                    disabled={isPending}
                  >
                    <Undo2 className="h-3.5 w-3.5" />
                    {t("detail.restore")}
                  </Button>
                )}
                <div className="ml-auto flex items-center gap-0.5">
                  {isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin text-muted-foreground" aria-hidden />}
                  {shown && canWrite && (
                    <ToolbarIcon
                      label={t("detail.duplicate")}
                      onClick={() => setMode({ kind: "duplicate" })}
                      disabled={isPending}
                    >
                      <CopyPlus className="h-4 w-4" />
                    </ToolbarIcon>
                  )}
                  {shown && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-9"
                      asChild
                      aria-label={t("detail.downloadIcs")}
                      title={t("detail.downloadIcs")}
                    >
                      <a href={`/api/appointments/${shown.id}/ics`} download>
                        <Download className="h-4 w-4" />
                      </a>
                    </Button>
                  )}
                  {shown && canWrite && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-9"
                          aria-label={t("detail.moreActions")}
                          title={t("detail.moreActions")}
                          disabled={isPending}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-52">
                        {!cancelled && !recurring && (
                          <DropdownMenuItem
                            onSelect={() =>
                              run(
                                () => setAppointmentCompleted(shown.id, shown.status !== "completed"),
                                shown.status === "completed"
                                  ? t("detail.markedScheduled")
                                  : t("detail.markedCompleted"),
                              )
                            }
                          >
                            {shown.status === "completed" ? (
                              <>
                                <RotateCcw className="h-4 w-4" />
                                {t("detail.markScheduled")}
                              </>
                            ) : (
                              <>
                                <CheckCircle2 className="h-4 w-4" />
                                {t("detail.markCompleted")}
                              </>
                            )}
                          </DropdownMenuItem>
                        )}
                        {shown.status === "scheduled" && hasInvitees && (
                          <DropdownMenuItem onSelect={() => run(() => resendInvitations(shown.id), t("detail.resent"))}>
                            <Send className="h-4 w-4" />
                            {t("detail.resend")}
                          </DropdownMenuItem>
                        )}
                        {shown.status === "scheduled" && (
                          <DropdownMenuItem onSelect={() => openConfirm("cancel")}>
                            <Ban className="h-4 w-4" />
                            {t("cancel")}
                          </DropdownMenuItem>
                        )}
                        {canDelete && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onSelect={() => openConfirm("delete")}
                            >
                              <Trash2 className="h-4 w-4" />
                              {t("detail.delete")}
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                  <ToolbarIcon label={t("detail.close")} onClick={close}>
                    <X className="h-4 w-4" />
                  </ToolbarIcon>
                </div>
              </>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {/* ── Editing, in place ─────────────────────────────────────────── */}
            {editing && shown && (
              <div className="px-5 pt-3">
                <SheetDescription className="sr-only">{t("detail.description")}</SheetDescription>
                <AppointmentForm
                  variant="panel"
                  mode={mode.kind === "duplicate" ? "duplicate" : "edit"}
                  timeZone={timeZone}
                  initial={draftFromAppointment(shown, timeZone, {
                    asCopy: mode.kind === "duplicate",
                    occurrence: occurrenceDate,
                  })}
                  appointmentId={mode.kind === "edit" ? shown.id : undefined}
                  target={mode.kind === "edit" ? mode.target : undefined}
                  initialConferenceLink={shown.conferenceLink}
                  onCancel={() => setMode({ kind: "view" })}
                  onDone={() => {
                    // A copy, or a series edited from one of its occurrences, may
                    // not be this appointment any more: back to the calendar.
                    if (mode.kind === "duplicate" || (mode.kind === "edit" && mode.target)) close();
                    else {
                      setMode({ kind: "view" });
                      load(shown.id);
                    }
                  }}
                />
              </div>
            )}

            {/* ── Loading / gone ────────────────────────────────────────────── */}
            {!editing && !shown && loading && (
              <div className="space-y-4 px-5 py-6" aria-busy="true">
                <SheetTitle className="sr-only">{tc("loading")}</SheetTitle>
                <Skeleton className="h-7 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="mt-6 h-10 w-full" />
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            )}
            {!editing && !shown && !loading && (
              <div className="px-5 py-12 text-center text-muted-foreground text-sm">
                <SheetTitle className="sr-only">{t("detail.fallbackTitle")}</SheetTitle>
                {missing ? t("detail.notFound") : null}
              </div>
            )}

            {/* ── Reading ───────────────────────────────────────────────────── */}
            {!editing && shown && start && end && (
              <article>
                <SheetDescription className="sr-only">{t("detail.description")}</SheetDescription>
                <header className="px-5 pt-5 pb-4">
                  {cancelled && (
                    <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700 text-sm dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
                      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
                      {t("detail.cancelledBanner")}
                    </div>
                  )}
                  <div className="flex items-start gap-3">
                    <span className="mt-2 size-3 shrink-0 rounded-[4px] bg-amber-500" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <SheetTitle
                        className={cn(
                          "break-words font-semibold text-xl leading-snug",
                          cancelled && "text-muted-foreground line-through",
                        )}
                      >
                        {shown.title}
                      </SheetTitle>
                      <p className="mt-1.5 text-sm first-letter:uppercase">{dateLine}</p>
                      <p className="text-muted-foreground text-sm">{timeLine}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {shown.status !== "scheduled" && shown.status in STATUS_CHIP && (
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 font-medium text-xs",
                              STATUS_CHIP[shown.status as keyof typeof STATUS_CHIP],
                            )}
                          >
                            {t(`status.${shown.status}`)}
                          </span>
                        )}
                        {start > new Date() && shown.status === "scheduled" && (
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary text-xs">
                            {formatter.relativeTime(start)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {shown.conferenceLink && !cancelled && (
                    <div className="mt-4 flex items-center gap-2">
                      <Button asChild className="h-10 flex-1 gap-2">
                        <a href={shown.conferenceLink} target="_blank" rel="noopener noreferrer">
                          <Video className="h-4 w-4" />
                          {t("detail.join")}
                        </a>
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="size-10 shrink-0"
                        onClick={() => copyLink(shown.conferenceLink ?? "")}
                        aria-label={t("detail.copyLink")}
                        title={t("detail.copyLink")}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </header>

                <div className="space-y-3.5 border-t px-5 py-4">
                  {rule && (
                    <Row icon={Repeat} label={t("recurrence.label")}>
                      <span className="block first-letter:uppercase">
                        {describeRecurrence(t, rule, new Date(shown.startAt), shown.timezone, locale)}
                      </span>
                    </Row>
                  )}
                  {shown.recurrenceParentId && (
                    <Row icon={Repeat} label={t("recurrence.label")}>
                      <span className="text-muted-foreground">{t("detail.detachedOccurrence")}</span>
                    </Row>
                  )}
                  {shown.location && (
                    <Row icon={MapPin} label={t("fields.locationLabel")}>
                      <a
                        href={locationHref(shown.location, shown.locationUrl)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-start gap-1 break-words text-primary underline-offset-2 hover:underline"
                      >
                        <span className="min-w-0 break-words">{shown.location}</span>
                        <ExternalLink className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                      </a>
                    </Row>
                  )}
                  {shown.conferenceLink && (
                    <Row icon={Video} label={t("fields.conferenceLabel")}>
                      <span className="block break-all text-muted-foreground text-xs">{shown.conferenceLink}</span>
                    </Row>
                  )}
                  {shown.link && (
                    <Row icon={Link2} label={t("fields.relatedLabel")}>
                      <span className="text-muted-foreground">{te(`${shown.link.type}.one`)} · </span>
                      <Link
                        href={entityHref(shown.link.type, shown.link.id)}
                        className="font-medium text-primary underline-offset-2 hover:underline"
                      >
                        {shown.link.label || "—"}
                      </Link>
                    </Row>
                  )}
                  <Row icon={shown.reminderMinutes === null ? BellOff : Bell} label={t("fields.reminderLabel")}>
                    <span className={cn(shown.reminderMinutes === null && "text-muted-foreground")}>
                      {shown.reminderMinutes === null
                        ? t("fields.reminderNone")
                        : reminderLabel(t, shown.reminderMinutes)}
                    </span>
                  </Row>
                </div>

                {/* Participants */}
                <section className="border-t px-5 py-4" aria-labelledby="apt-people">
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 id="apt-people" className="flex items-center gap-1.5 font-semibold text-sm">
                      <Users className="h-4 w-4 text-muted-foreground" aria-hidden />
                      {t("detail.participantsCount", { count: invitees.length + (organizerRow ? 1 : 0) })}
                    </h3>
                    {hasInvitees && (
                      <p className="text-right text-muted-foreground text-xs">
                        {tally
                          .filter((x) => x.count > 0)
                          .map((x) => t(`detail.tally.${x.status}`, { count: x.count }))
                          .join(" · ")}
                      </p>
                    )}
                  </div>
                  {hasInvitees && (
                    <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                      {tally.map((x) =>
                        x.count > 0 ? (
                          <div
                            key={x.status}
                            className={RSVP[x.status].bar}
                            style={{ width: `${(x.count / invitees.length) * 100}%` }}
                          />
                        ) : null,
                      )}
                    </div>
                  )}
                  <ul className="mt-2 divide-y">
                    {organizerRow && person(organizerRow, true)}
                    {invitees.map((a) => person(a, false))}
                  </ul>
                  {!hasInvitees && (
                    <p className="mt-1 text-muted-foreground text-sm">{t("detail.noExternalParticipants")}</p>
                  )}
                  {recurring && hasInvitees && (
                    <p className="mt-2 text-muted-foreground text-xs">{t("detail.seriesAnswers")}</p>
                  )}
                </section>

                {/* The copilot's briefing: only with a record to brief from. */}
                {aiBriefing && shown.link && (
                  <div className="border-t px-5 py-4">
                    <AiBriefing key={shown.id} appointmentId={shown.id} entry={aiBriefing} />
                  </div>
                )}

                {/* Notes */}
                {shown.description && (
                  <section className="border-t px-5 py-4" aria-labelledby="apt-notes">
                    <h3 id="apt-notes" className="mb-2 flex items-center gap-1.5 font-semibold text-sm">
                      <FileText className="h-4 w-4 text-muted-foreground" aria-hidden />
                      {t("fields.notesLabel")}
                    </h3>
                    <p className="whitespace-pre-wrap break-words text-muted-foreground text-sm">{shown.description}</p>
                  </section>
                )}

                <p className="border-t px-5 py-3 text-muted-foreground text-xs">
                  {t("detail.lastUpdated", {
                    date: formatter.dateTime(new Date(shown.updatedAt), {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                      ...tz,
                    }),
                  })}
                </p>
              </article>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Which occurrences an edit is for */}
      <AlertDialog open={askScopeForEdit} onOpenChange={(v) => !v && setAskScopeForEdit(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("scope.editTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("scope.editBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <ScopeChoice value={scope} onChange={setScope} />
          <AlertDialogFooter>
            <AlertDialogCancel>{t("detail.confirmBack")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setAskScopeForEdit(false);
                if (start) setMode({ kind: "edit", target: { scope, occurrence: start.toISOString() } });
              }}
            >
              {t("scope.continue")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel / delete confirmation */}
      <AlertDialog open={confirm !== null} onOpenChange={(v) => !v && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === "delete" ? t("detail.deleteConfirmTitle") : t("detail.confirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {recurring
                ? t("scope.removeBody")
                : confirm === "delete"
                  ? t("detail.deleteConfirmBody")
                  : t("detail.confirmBodyShort")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {recurring && <ScopeChoice value={scope} onChange={setScope} />}
          {hasInvitees && isUpcoming && shown?.status === "scheduled" && (
            <label htmlFor="apt-notify-remove" className="flex cursor-pointer items-start gap-2 text-sm">
              <Checkbox
                id="apt-notify-remove"
                checked={notifyOnRemove}
                onCheckedChange={(v) => setNotifyOnRemove(v === true)}
                className="mt-0.5"
              />
              <span>{t("detail.notifyOnRemove", { count: invitees.length })}</span>
            </label>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>{t("detail.confirmBack")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending}
              onClick={(e) => {
                e.preventDefault();
                if (confirm === "delete") handleDelete();
                else handleCancel();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {confirm === "delete" ? t("detail.deleteYes") : t("detail.confirmYes")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
