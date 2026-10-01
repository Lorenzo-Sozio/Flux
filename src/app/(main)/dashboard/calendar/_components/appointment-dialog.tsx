"use client";

import { useEffect, useState, useTransition } from "react";

import {
  AlertTriangle,
  Bell,
  CalendarCheck,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  FileText,
  Link2,
  Loader2,
  MapPin,
  Sun,
  UserPlus,
  Users,
  Video,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import {
  type AppointmentLink,
  type AttendeeInput,
  createAppointment,
  type getAppointmentById,
  getContactsForPicker,
  getInternalUsers,
  getOverlappingAppointments,
  type InviteResult,
  type OccurrenceTarget,
  updateAppointment,
} from "@/actions/appointments";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useOpenOnNew } from "@/hooks/use-open-on-new";
import { cn } from "@/lib/utils";
import {
  addDaysToDate,
  addMinutesToWall,
  fromWallValue,
  toWallDate,
  toWallValue,
  wallDiffMinutes,
} from "@/lib/wall-clock";

import {
  DURATION_OPTIONS,
  durationLabel,
  NEW_APPOINTMENT_EVENT,
  type NewAppointmentDetail,
  REMINDER_OPTIONS,
  reminderLabel,
} from "./appointment-format";
import { AvailabilityPicker } from "./availability-picker";
import { RecurrencePicker } from "./recurrence-picker";
import { RelatedRecordPicker } from "./related-record-picker";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type AppointmentDetail = NonNullable<Awaited<ReturnType<typeof getAppointmentById>>>;

interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
}

interface InternalUser {
  id: string;
  name: string | null;
  email: string | null;
}

interface AttendeeEntry extends AttendeeInput {
  key: string; // local key for React list
  /** The answer already given, shown while editing. */
  status?: string;
}

type ConferenceType = "none" | "jitsi" | "custom";

/**
 * Everything the form edits, as the form holds it. Times are wall-clock values
 * on the workspace's clock ("yyyy-MM-ddTHH:mm"), the same clock the grid is
 * drawn on, whatever zone the browser happens to be in.
 */
export interface AppointmentDraft {
  title: string;
  description: string;
  allDay: boolean;
  startAt: string;
  endAt: string;
  /** All day: the first and the last day, inclusive ("yyyy-MM-dd"). */
  startDate: string;
  endDate: string;
  recurrenceRule: string | null;
  location: string;
  conferenceType: ConferenceType;
  conferenceLink: string;
  reminderMinutes: number | null;
  attendees: AttendeeEntry[];
  link: AppointmentLink | null;
}

type Mode = "create" | "edit" | "duplicate";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** The next whole hour, on the workspace's clock. */
function defaultStart(timeZone: string): string {
  const next = new Date(Math.ceil((Date.now() + 1) / 3_600_000) * 3_600_000);
  return toWallValue(next, timeZone);
}

export function emptyDraft(timeZone: string, start?: string, allDay = false): AppointmentDraft {
  const s =
    start && start.length >= 16 ? start.slice(0, 16) : start ? `${start.slice(0, 10)}T09:00` : defaultStart(timeZone);
  return {
    title: "",
    description: "",
    allDay,
    startAt: s,
    endAt: addMinutesToWall(s, 60),
    startDate: s.slice(0, 10),
    endDate: s.slice(0, 10),
    recurrenceRule: null,
    location: "",
    conferenceType: "none",
    conferenceLink: "",
    reminderMinutes: allDay ? null : 30,
    attendees: [],
    link: null,
  };
}

/**
 * The form's view of a saved appointment, at the occurrence it was opened from.
 * A copy keeps what the meeting is and who it is with, and drops what belongs to
 * the original: the answers given to it and the Jitsi room, which a new
 * appointment gets its own of.
 */
export function draftFromAppointment(
  appt: AppointmentDetail,
  timeZone: string,
  options: { asCopy?: boolean; occurrence?: Date | null } = {},
): AppointmentDraft {
  const conferenceType: ConferenceType =
    appt.conferenceType === "jitsi" ? "jitsi" : appt.conferenceLink ? "custom" : "none";
  const start = options.occurrence ?? new Date(appt.startAt);
  const end = new Date(start.getTime() + (new Date(appt.endAt).getTime() - new Date(appt.startAt).getTime()));
  const startDate = toWallDate(start, timeZone);
  // An all-day event ends at midnight after its last day.
  const endDate = appt.allDay ? toWallDate(new Date(end.getTime() - 60_000), timeZone) : toWallDate(end, timeZone);
  return {
    title: appt.title,
    description: appt.description ?? "",
    allDay: appt.allDay,
    startAt: appt.allDay ? `${startDate}T09:00` : toWallValue(start, timeZone),
    endAt: appt.allDay ? `${startDate}T10:00` : toWallValue(end, timeZone),
    startDate,
    endDate: endDate < startDate ? startDate : endDate,
    recurrenceRule: appt.recurrenceRule,
    location: appt.location ?? "",
    conferenceType,
    conferenceLink: conferenceType === "custom" ? (appt.conferenceLink ?? "") : "",
    reminderMinutes: appt.reminderMinutes,
    attendees: appt.attendees
      .filter((a) => a.role !== "organizer")
      .map((a) => ({
        key: a.id,
        email: a.email,
        name: a.name,
        role: a.role === "optional" ? "optional" : "required",
        userId: a.userId ?? undefined,
        contactId: a.contactId ?? undefined,
        status: options.asCopy ? undefined : a.status,
      })),
    link: appt.link,
  };
}

const RSVP_DOT: Record<string, string> = {
  accepted: "bg-green-500",
  declined: "bg-red-500",
  tentative: "bg-amber-500",
  pending: "bg-gray-400",
};

// ─── Participant search row ────────────────────────────────────────────────────

function ParticipantSearch({
  users,
  contacts,
  existing,
  onAdd,
}: {
  users: InternalUser[];
  contacts: Contact[];
  existing: AttendeeEntry[];
  onAdd: (a: AttendeeEntry) => void;
}) {
  const [query, setQuery] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualEmail, setManualEmail] = useState("");
  const [tab, setTab] = useState<"search" | "manual">("search");
  const t = useTranslations("appointment");

  const existingEmails = new Set(existing.map((e) => e.email.toLowerCase()));

  const suggestions =
    query.trim().length >= 2
      ? [
          ...users
            .filter(
              (u) =>
                u.email &&
                !existingEmails.has(u.email.toLowerCase()) &&
                `${u.name ?? ""} ${u.email}`.toLowerCase().includes(query.toLowerCase()),
            )
            .slice(0, 5)
            .map((u) => ({
              key: `user-${u.id}`,
              label: u.name ?? u.email ?? "",
              sublabel: u.email ?? "",
              internal: true,
              entry: {
                key: `user-${u.id}`,
                email: u.email ?? "",
                name: u.name ?? u.email ?? "",
                userId: u.id,
                role: "required",
              } as AttendeeEntry,
            })),
          ...contacts
            .filter(
              (c) =>
                c.email &&
                !existingEmails.has(c.email.toLowerCase()) &&
                `${c.firstName} ${c.lastName} ${c.email}`.toLowerCase().includes(query.toLowerCase()),
            )
            .slice(0, 5)
            .map((c) => ({
              key: `contact-${c.id}`,
              label: `${c.firstName} ${c.lastName}`,
              sublabel: c.email ?? "",
              internal: false,
              entry: {
                key: `contact-${c.id}`,
                email: c.email ?? "",
                name: `${c.firstName} ${c.lastName}`,
                contactId: c.id,
                role: "required",
              } as AttendeeEntry,
            })),
        ]
      : [];

  const addManual = () => {
    const name = manualName.trim();
    const email = manualEmail.trim();
    if (!name || !email) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error(t("dialog.invalidEmail"));
      return;
    }
    if (existingEmails.has(email.toLowerCase())) {
      toast.error(t("dialog.alreadyAdded"));
      return;
    }
    onAdd({ key: `manual-${Date.now()}`, email, name, role: "required" });
    setManualName("");
    setManualEmail("");
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        {(["search", "manual"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setTab(v)}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              tab === v
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-muted-foreground hover:border-primary/50"
            }`}
          >
            {v === "search" ? t("fields.participantsSearch") : t("fields.participantsManual")}
          </button>
        ))}
      </div>

      {tab === "search" && (
        <div className="relative">
          <Input
            placeholder={t("fields.participantsSearchPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-8 text-sm"
          />
          {suggestions.length > 0 && (
            <div className="absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-md border bg-popover shadow-md">
              {suggestions.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
                  onClick={() => {
                    onAdd(s.entry);
                    setQuery("");
                  }}
                >
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted font-semibold text-xs">
                    {s.label.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{s.label}</div>
                    <div className="truncate text-muted-foreground text-xs">{s.sublabel}</div>
                  </div>
                  {s.internal && (
                    <Badge variant="outline" className="h-4 shrink-0 px-1 py-0 text-[10px]">
                      {t("fields.participantsInternal")}
                    </Badge>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "manual" && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            placeholder={t("fields.participantsNamePlaceholder")}
            value={manualName}
            onChange={(e) => setManualName(e.target.value)}
            className="h-8 text-sm"
          />
          <Input
            placeholder={t("fields.participantsEmailPlaceholder")}
            type="email"
            value={manualEmail}
            onChange={(e) => setManualEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addManual();
              }
            }}
            className="h-8 text-sm"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 shrink-0 px-2"
            aria-label={t("fields.participantsAdd")}
            onClick={addManual}
          >
            <UserPlus className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Invite outcome ───────────────────────────────────────────────────────────

export function useInviteToast() {
  const t = useTranslations("appointment");
  return (inviteStatus: InviteResult) => {
    if (inviteStatus.noProvider) {
      toast.warning(t("dialog.noProvider"), { duration: 6000 });
    } else if (inviteStatus.sent > 0 && inviteStatus.failed === 0) {
      toast.success(t("dialog.invitesSent", { count: inviteStatus.sent }));
    } else if (inviteStatus.sent > 0 && inviteStatus.failed > 0) {
      toast.warning(t("dialog.invitesPartial", { sent: inviteStatus.sent, failed: inviteStatus.failed }), {
        duration: 6000,
      });
    } else if (inviteStatus.failed > 0) {
      toast.error(t("dialog.invitesFailed", { count: inviteStatus.failed }), { duration: 6000 });
    }
  };
}

// ─── The form ─────────────────────────────────────────────────────────────────

/**
 * Mounted only while the dialog is open (Radix unmounts closed content), so the
 * state below starts from `initial` every time it opens and nothing typed into
 * one appointment leaks into the next.
 */
export function AppointmentForm({
  mode,
  initial,
  timeZone,
  appointmentId,
  target,
  initialConferenceLink,
  onDone,
  onCancel,
  variant = "dialog",
}: {
  /** Where it is drawn: a dialog, or the detail panel it replaces while editing. */
  variant?: "dialog" | "panel";
  mode: Mode;
  initial: AppointmentDraft;
  timeZone: string;
  appointmentId?: string;
  /** For a repeating appointment: the occurrence edited, and how far the edit reaches. */
  target?: OccurrenceTarget;
  /** The Jitsi room an edited appointment already has, which is kept. */
  initialConferenceLink?: string | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("appointment");
  const tc = useTranslations("common");
  const inviteToast = useInviteToast();
  const [isPending, startTransition] = useTransition();

  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [allDay, setAllDay] = useState(initial.allDay);
  const [startAt, setStartAt] = useState(initial.startAt);
  const [endAt, setEndAt] = useState(initial.endAt);
  const [startDate, setStartDate] = useState(initial.startDate);
  const [endDate, setEndDate] = useState(initial.endDate);
  const [recurrenceRule, setRecurrenceRule] = useState<string | null>(initial.recurrenceRule);
  const [location, setLocation] = useState(initial.location);
  const [conferenceType, setConferenceType] = useState<ConferenceType>(initial.conferenceType);
  const [customLink, setCustomLink] = useState(initial.conferenceLink);
  const [reminderMinutes, setReminderMinutes] = useState<number | null>(initial.reminderMinutes);
  const [attendees, setAttendees] = useState<AttendeeEntry[]>(initial.attendees);
  const [link, setLink] = useState<AppointmentLink | null>(initial.link);
  const [notify, setNotify] = useState(true);

  const [internalUsers, setInternalUsers] = useState<InternalUser[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [conflicts, setConflicts] = useState<{ id: string; title: string }[]>([]);
  const [showAvailability, setShowAvailability] = useState(false);

  useEffect(() => {
    Promise.all([getInternalUsers(), getContactsForPicker()])
      .then(([u, c]) => {
        setInternalUsers(u);
        setContacts(c);
      })
      // The pickers are a convenience; typing an address still works without them.
      // biome-ignore lint/suspicious/noEmptyBlockStatements: best-effort
      .catch(() => {});
  }, []);

  // The instants the form currently means, on the workspace's clock.
  const start = allDay ? fromWallValue(startDate, timeZone) : fromWallValue(startAt, timeZone);
  const end = allDay ? fromWallValue(addDaysToDate(endDate || startDate, 1), timeZone) : fromWallValue(endAt, timeZone);
  const validRange = Boolean(start && end && end > start);
  const durationMinutes = !allDay && startAt && endAt ? wallDiffMinutes(startAt, endAt) : 0;
  const editingOneOccurrence = mode === "edit" && target?.scope === "this";

  const startMs = start?.getTime() ?? null;
  const endMs = end?.getTime() ?? null;
  useEffect(() => {
    // An all-day appointment clashes with nothing, as in every calendar.
    if (allDay || startMs === null || endMs === null || endMs <= startMs) {
      setConflicts([]);
      return;
    }
    const timer = setTimeout(() => {
      getOverlappingAppointments(new Date(startMs), new Date(endMs), mode === "edit" ? appointmentId : undefined)
        .then(setConflicts)
        .catch(() => setConflicts([]));
    }, 500);
    return () => clearTimeout(timer);
  }, [startMs, endMs, allDay, mode, appointmentId]);

  // Moving the start keeps the length, as every calendar does: an hour-long
  // meeting moved to three o'clock still ends at four.
  const handleStartChange = (v: string) => {
    if (!v) return setStartAt(v);
    setEndAt(addMinutesToWall(v, durationMinutes > 0 ? durationMinutes : 60));
    setStartAt(v);
  };
  const handleStartDateChange = (v: string) => {
    if (!v) return setStartDate(v);
    const span = startDate && endDate ? wallDiffMinutes(`${startDate}T00:00`, `${endDate}T00:00`) / 1440 : 0;
    setStartDate(v);
    setEndDate(addDaysToDate(v, Math.max(0, span)));
  };
  const toggleAllDay = (on: boolean) => {
    setAllDay(on);
    if (on) {
      setStartDate(startAt.slice(0, 10));
      setEndDate(endAt.slice(0, 10) > startAt.slice(0, 10) ? endAt.slice(0, 10) : startAt.slice(0, 10));
    } else {
      setStartAt(`${startDate}T09:00`);
      setEndAt(`${startDate}T10:00`);
    }
  };

  const timeChanged =
    mode === "edit" &&
    (allDay !== initial.allDay ||
      (allDay
        ? startDate !== initial.startDate || endDate !== initial.endDate
        : startAt !== initial.startAt || endAt !== initial.endAt));
  const answered = attendees.some((a) => a.status && a.status !== "pending");
  const reminderChoices: number[] = [...REMINDER_OPTIONS];
  if (reminderMinutes !== null && !reminderChoices.includes(reminderMinutes)) {
    reminderChoices.push(reminderMinutes);
    reminderChoices.sort((a, b) => a - b);
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error(t("titleRequired"));
      return;
    }
    if (!start || !end) {
      toast.error(t("dateRequired"));
      return;
    }
    if (!validRange) {
      toast.error(t("endBeforeStart"));
      return;
    }
    if (conferenceType === "custom" && customLink.trim() && !/^https?:\/\//i.test(customLink.trim())) {
      toast.error(t("dialog.invalidLink"));
      return;
    }

    const people = attendees.map(({ key: _k, status: _s, ...a }) => a);
    const shouldNotify = notify && people.length > 0;
    const startInstant = start;
    const endInstant = end;

    startTransition(async () => {
      try {
        if (mode === "edit" && appointmentId) {
          const { inviteStatus } = await updateAppointment(
            appointmentId,
            {
              title: title.trim(),
              description: description.trim() || null,
              startAt: startInstant,
              endAt: endInstant,
              allDay,
              ...(editingOneOccurrence ? {} : { recurrenceRule }),
              location: location.trim() || null,
              conferenceType,
              conferenceLink: conferenceType === "custom" ? customLink.trim() || null : null,
              reminderMinutes,
              contactId: link?.type === "contact" ? link.id : null,
              companyId: link?.type === "company" ? link.id : null,
              dealId: link?.type === "deal" ? link.id : null,
              leadId: link?.type === "lead" ? link.id : null,
              attendees: people,
              notifyAttendees: shouldNotify,
            },
            target,
          );
          toast.success(t("dialog.updated"));
          if (shouldNotify) inviteToast(inviteStatus);
        } else {
          const { inviteStatus } = await createAppointment({
            title: title.trim(),
            description: description.trim() || undefined,
            startAt: startInstant,
            endAt: endInstant,
            allDay,
            recurrenceRule,
            location: location.trim() || undefined,
            conferenceType: conferenceType !== "none" ? conferenceType : undefined,
            conferenceLink: conferenceType === "custom" ? customLink.trim() || undefined : undefined,
            autoGenerateLink: conferenceType === "jitsi",
            reminderMinutes: reminderMinutes ?? undefined,
            contactId: link?.type === "contact" ? link.id : undefined,
            companyId: link?.type === "company" ? link.id : undefined,
            dealId: link?.type === "deal" ? link.id : undefined,
            leadId: link?.type === "lead" ? link.id : undefined,
            attendees: people,
            notifyAttendees: shouldNotify,
          });
          toast.success(t("dialog.created"));
          if (shouldNotify) inviteToast(inviteStatus);
        }
        onDone();
      } catch {
        toast.error(mode === "edit" ? t("errorUpdate") : t("errorCreate"));
      }
    });
  };

  const inputClass =
    "flex h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

  return (
    <form onSubmit={handleSubmit} className="space-y-5 pt-2">
      {target && mode === "edit" && (
        <p className="rounded-md bg-muted/50 px-3 py-2 text-muted-foreground text-xs">
          {t(`scope.editing.${target.scope}`)}
        </p>
      )}

      {/* Title */}
      <div className="space-y-1.5">
        <Label htmlFor="apt-title">{t("fields.titleLabel")} *</Label>
        <Input
          id="apt-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("fields.titlePlaceholder")}
          autoFocus
          maxLength={200}
        />
      </div>

      {/* Date / time */}
      <div className="space-y-2">
        <label htmlFor="apt-allday" className="flex w-fit cursor-pointer items-center gap-2 text-sm">
          <Checkbox id="apt-allday" checked={allDay} onCheckedChange={(v) => toggleAllDay(v === true)} />
          <Sun className="h-3.5 w-3.5 text-muted-foreground" />
          {t("fields.allDay")}
        </label>

        {allDay ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="apt-start-date">{t("fields.startDateLabel")} *</Label>
              <input
                id="apt-start-date"
                type="date"
                value={startDate}
                onChange={(e) => handleStartDateChange(e.target.value)}
                className={inputClass}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="apt-end-date">{t("fields.endDateLabel")} *</Label>
              <input
                id="apt-end-date"
                type="date"
                value={endDate}
                min={startDate}
                onChange={(e) => setEndDate(e.target.value)}
                className={cn(inputClass, !validRange && endDate && "border-destructive")}
              />
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="apt-start" className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" /> {t("fields.startLabel")} *
                </Label>
                <input
                  id="apt-start"
                  type="datetime-local"
                  value={startAt}
                  onChange={(e) => handleStartChange(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="apt-end">{t("fields.endLabel")} *</Label>
                <input
                  id="apt-end"
                  type="datetime-local"
                  value={endAt}
                  min={startAt}
                  onChange={(e) => setEndAt(e.target.value)}
                  className={cn(inputClass, !validRange && endAt && "border-destructive")}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-muted-foreground text-xs">
                {t("fields.durationLabel")}:{" "}
                <span className="font-medium text-foreground">
                  {validRange ? durationLabel(t, durationMinutes) : "—"}
                </span>
              </span>
              {DURATION_OPTIONS.map((m) => (
                <button
                  key={m}
                  type="button"
                  disabled={!startAt}
                  onClick={() => setEndAt(addMinutesToWall(startAt, m))}
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                    validRange && durationMinutes === m
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/40",
                  )}
                >
                  {durationLabel(t, m)}
                </button>
              ))}
            </div>
          </>
        )}
        <p className="text-[11px] text-muted-foreground">{t("fields.timeZoneHint", { zone: timeZone })}</p>
        {timeChanged && answered && <p className="text-muted-foreground text-xs">{t("dialog.timeChangedHint")}</p>}
      </div>

      {/* Recurrence: a single occurrence edited on its own has none */}
      {!editingOneOccurrence && (
        <RecurrencePicker
          value={recurrenceRule}
          onChange={setRecurrenceRule}
          start={allDay ? startDate : startAt}
          timeZone={timeZone}
        />
      )}

      {/* Conflict warning */}
      {conflicts.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 dark:border-amber-800 dark:bg-amber-950/30">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div className="min-w-0 text-amber-800 text-sm dark:text-amber-300">
            {t.rich("dialog.conflict", {
              strong: (chunks) => <span className="font-semibold">{chunks}</span>,
              titles: conflicts.map((c) => c.title).join(", "),
            })}
          </div>
        </div>
      )}

      {/* Related record */}
      <div className="space-y-1.5">
        <Label className="flex items-center gap-1.5">
          <Link2 className="h-3.5 w-3.5" /> {t("fields.relatedLabel")}
        </Label>
        <RelatedRecordPicker value={link} onChange={setLink} />
      </div>

      {/* Location */}
      <div className="space-y-1.5">
        <Label htmlFor="apt-location" className="flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5" /> {t("fields.locationLabel")}
        </Label>
        <Input
          id="apt-location"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder={t("fields.locationPlaceholder")}
        />
      </div>

      {/* Conference */}
      <div className="space-y-2">
        <Label className="flex items-center gap-1.5">
          <Video className="h-3.5 w-3.5" /> {t("fields.conferenceLabel")}
        </Label>
        <div className="flex flex-wrap gap-2">
          {(["none", "jitsi", "custom"] as ConferenceType[]).map((ct) => {
            const LABELS = {
              none: t("fields.conferenceNone"),
              jitsi: t("fields.conferenceJitsi"),
              custom: t("fields.conferenceCustom"),
            };
            return (
              <button
                key={ct}
                type="button"
                onClick={() => setConferenceType(ct)}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-medium text-xs transition-all ${
                  conferenceType === ct
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/40"
                }`}
              >
                {ct === "jitsi" && <Link2 className="h-3 w-3" />}
                {LABELS[ct]}
              </button>
            );
          })}
        </div>
        {conferenceType === "jitsi" && (
          <p className="flex items-center gap-1.5 text-muted-foreground text-xs">
            <Check className="h-3 w-3 shrink-0 text-green-500" />
            {mode === "edit" && initialConferenceLink && initial.conferenceType === "jitsi" ? (
              <span className="min-w-0 break-all">{t("dialog.jitsiKept", { link: initialConferenceLink })}</span>
            ) : (
              t("dialog.jitsiHint")
            )}
          </p>
        )}
        {conferenceType === "custom" && (
          <Input
            value={customLink}
            onChange={(e) => setCustomLink(e.target.value)}
            placeholder="https://zoom.us/j/…"
            type="url"
            className="text-sm"
          />
        )}
      </div>

      {/* Description / notes */}
      <div className="space-y-1.5">
        <Label htmlFor="apt-desc" className="flex items-center gap-1.5">
          <FileText className="h-3.5 w-3.5" /> {t("fields.notesLabel")}
        </Label>
        <Textarea
          id="apt-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("fields.notesPlaceholder")}
          rows={3}
          className="resize-y text-sm"
        />
      </div>

      {/* Reminder */}
      <div className="space-y-1.5">
        <Label htmlFor="apt-reminder" className="flex items-center gap-1.5">
          <Bell className="h-3.5 w-3.5" /> {t("fields.reminderLabel")}
        </Label>
        <select
          id="apt-reminder"
          value={reminderMinutes ?? ""}
          onChange={(e) => setReminderMinutes(e.target.value === "" ? null : Number(e.target.value))}
          className={inputClass}
        >
          <option value="">{t("fields.reminderNone")}</option>
          {reminderChoices.map((m) => (
            <option key={m} value={m}>
              {reminderLabel(t, m)}
            </option>
          ))}
        </select>
        <p className="text-muted-foreground text-xs">
          {allDay ? t("fields.reminderHintAllDay") : t("fields.reminderHint")}
        </p>
      </div>

      {/* Participants */}
      <div className="space-y-2">
        <Label className="flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5" /> {t("fields.participantsLabel")}
          {attendees.length > 0 && <span className="text-muted-foreground">({attendees.length})</span>}
        </Label>

        {attendees.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {attendees.map((a) => (
              <div
                key={a.key}
                className="flex min-w-0 max-w-full items-center gap-1.5 rounded-full bg-secondary py-1 pr-2 pl-1 text-xs"
              >
                <div className="relative flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted font-semibold">
                  {a.name.charAt(0).toUpperCase()}
                  {a.status && (
                    <span
                      className={cn(
                        "-right-0.5 -bottom-0.5 absolute size-2 rounded-full ring-1 ring-secondary",
                        RSVP_DOT[a.status] ?? RSVP_DOT.pending,
                      )}
                      title={t(`rsvp.${a.status in RSVP_DOT ? a.status : "pending"}`)}
                    />
                  )}
                </div>
                <span className="truncate font-medium">{a.name}</span>
                <span className="hidden truncate text-muted-foreground sm:inline">{a.email}</span>
                {a.userId && (
                  <Badge variant="outline" className="h-4 shrink-0 px-1 py-0 text-[10px]">
                    {t("fields.participantsInternal")}
                  </Badge>
                )}
                <button
                  type="button"
                  title={t("fields.roleToggleHint")}
                  onClick={() =>
                    setAttendees((prev) =>
                      prev.map((x) =>
                        x.key === a.key ? { ...x, role: x.role === "optional" ? "required" : "optional" } : x,
                      ),
                    )
                  }
                  className={cn(
                    "shrink-0 rounded px-1 text-[10px] transition-colors hover:bg-muted",
                    a.role === "optional" ? "text-muted-foreground italic" : "text-foreground",
                  )}
                >
                  {a.role === "optional" ? t("fields.roleOptional") : t("fields.roleRequired")}
                </button>
                <button
                  type="button"
                  aria-label={t("fields.participantsRemove", { name: a.name })}
                  onClick={() => setAttendees((prev) => prev.filter((x) => x.key !== a.key))}
                  className="ml-0.5 shrink-0 text-muted-foreground transition-colors hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <ParticipantSearch
          users={internalUsers}
          contacts={contacts}
          existing={attendees}
          onAdd={(a) => setAttendees((prev) => [...prev, a])}
        />

        {attendees.length === 0 && <p className="text-muted-foreground text-xs">{t("dialog.noParticipants")}</p>}
      </div>

      {/* Colleague availability */}
      {attendees.some((a) => a.userId) && !allDay && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setShowAvailability((prev) => !prev)}
            className="flex w-full items-center justify-between rounded-lg border px-3 py-2 font-medium text-sm transition-colors hover:bg-muted/40"
          >
            <span className="flex items-center gap-2">
              <CalendarCheck className="h-3.5 w-3.5 text-amber-500" />
              {t("dialog.checkAvailability")}
            </span>
            {showAvailability ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
          {showAvailability && (
            <AvailabilityPicker
              userIds={attendees.map((a) => a.userId).filter((id): id is string => Boolean(id))}
              users={internalUsers}
              date={startAt.slice(0, 10)}
              timeZone={timeZone}
              onSelect={(s, e) => {
                setStartAt(s);
                setEndAt(e);
                setShowAvailability(false);
              }}
            />
          )}
        </div>
      )}

      {/* Notify */}
      {attendees.length > 0 && (
        <label htmlFor="apt-notify" className="flex cursor-pointer items-start gap-2 text-sm">
          <Checkbox
            id="apt-notify"
            checked={notify}
            onCheckedChange={(v) => setNotify(v === true)}
            className="mt-0.5"
          />
          <span>{mode === "edit" ? t("dialog.notifyUpdate") : t("dialog.notifyCreate")}</span>
        </label>
      )}

      {/* ⚠️ Sticky: on a phone the form is several screens long, and a Save button
          after the last field is one nobody finds without scrolling to it. */}
      <div
        className={cn(
          "sticky bottom-0 z-10 flex items-center justify-end gap-2 border-t bg-background py-3",
          variant === "panel" && "-mx-5 px-5",
        )}
      >
        <Button type="button" variant="ghost" onClick={onCancel}>
          {tc("cancel")}
        </Button>
        <Button type="submit" disabled={isPending} className="gap-2">
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarCheck className="h-4 w-4" />}
          {mode === "edit" ? t("dialog.save") : notify && attendees.length > 0 ? t("submit") : t("dialog.createOnly")}
        </Button>
      </div>
    </form>
  );
}

// ─── Controlled editor ────────────────────────────────────────────────────────

/** The dialog alone, for callers that decide when it opens (the detail panel). */
export function AppointmentEditorDialog({
  open,
  onOpenChange,
  mode,
  initial,
  timeZone,
  appointment,
  target,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: Mode;
  initial: AppointmentDraft;
  timeZone: string;
  /** The appointment being edited or copied. */
  appointment?: AppointmentDetail;
  target?: OccurrenceTarget;
  onSaved?: () => void;
}) {
  const t = useTranslations("appointment");
  const tCal = useTranslations("calendar");
  const heading =
    mode === "edit" ? t("edit") : mode === "duplicate" ? t("dialog.duplicateTitle") : tCal("newAppointment");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarCheck className="h-5 w-5 text-amber-500" />
            {heading}
          </DialogTitle>
        </DialogHeader>
        <AppointmentForm
          mode={mode}
          initial={initial}
          timeZone={timeZone}
          appointmentId={mode === "edit" ? appointment?.id : undefined}
          target={mode === "edit" ? target : undefined}
          initialConferenceLink={appointment?.conferenceLink}
          onCancel={() => onOpenChange(false)}
          onDone={() => {
            onOpenChange(false);
            onSaved?.();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

// ─── Create button ────────────────────────────────────────────────────────────

interface Props {
  /** The workspace's zone: the clock the form is filled in on. */
  timeZone: string;
  defaultDate?: string; // yyyy-MM-ddTHH:mm on the workspace's clock
  trigger?: React.ReactNode; // custom trigger; if omitted a default button is rendered
  /**
   * Open when the page is reached with ?new=true, and when an empty slot of the
   * grid is clicked. One per page.
   */
  openOnNew?: boolean;
  /**
   * Classes for the default button. The page hides it on a phone, where the
   * bottom bar's Create already offers a new appointment first — the dialog
   * itself stays mounted, because empty slots and `?new=true` open it.
   */
  triggerClassName?: string;
}

export function AppointmentDialog({ timeZone, defaultDate, trigger, openOnNew = false, triggerClassName }: Props) {
  const tCal = useTranslations("calendar");
  const [open, setOpen] = useState(false);
  const [slot, setSlot] = useState<NewAppointmentDetail | null>(null);
  useOpenOnNew(openOnNew, setOpen);

  useEffect(() => {
    if (!openOnNew) return;
    const onSlot = (e: Event) => {
      const detail = (e as CustomEvent<NewAppointmentDetail>).detail;
      if (!detail?.start) return;
      setSlot(detail);
      setOpen(true);
    };
    window.addEventListener(NEW_APPOINTMENT_EVENT, onSlot);
    return () => window.removeEventListener(NEW_APPOINTMENT_EVENT, onSlot);
  }, [openOnNew]);

  return (
    <>
      {trigger ? (
        <button type="button" onClick={() => setOpen(true)} className="contents">
          {trigger}
        </button>
      ) : (
        // ⚠️ The label was written in Italian, in the source, on the calendar's
        // primary action — so an English workspace read "Nuovo appuntamento".
        // And it was an outline button: the one thing this page exists to do,
        // styled as a secondary.
        <Button size="sm" className={cn("shrink-0 gap-2", triggerClassName)} onClick={() => setOpen(true)}>
          <CalendarCheck className="h-4 w-4" />
          {tCal("newAppointment")}
        </Button>
      )}

      <AppointmentEditorDialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) setSlot(null);
        }}
        mode="create"
        timeZone={timeZone}
        initial={emptyDraft(timeZone, slot?.start ?? defaultDate, slot?.allDay)}
      />
    </>
  );
}
