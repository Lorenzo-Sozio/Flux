"use client";

import { useCallback, useEffect, useState, useTransition } from "react";

import { useRouter } from "next/navigation";

import {
  AlertTriangle,
  CalendarCheck,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  FileText,
  Link2,
  Loader2,
  MapPin,
  UserPlus,
  Users,
  Video,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  type AttendeeInput,
  createAppointment,
  getContactsForPicker,
  getInternalUsers,
  getOverlappingAppointments,
} from "@/actions/appointments";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { AvailabilityPicker } from "./availability-picker";

// ─── Types ─────────────────────────────────────────────────────────────────────

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
}

type ConferenceType = "none" | "jitsi" | "custom";

interface Props {
  defaultDate?: string; // yyyy-MM-ddTHH:mm
  trigger?: React.ReactNode; // custom trigger; if omitted a default button is rendered
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toLocalDatetimeValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` + `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

function defaultStart(): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return toLocalDatetimeValue(d);
}

function defaultEnd(start: string): string {
  if (!start) return "";
  const d = new Date(start);
  d.setHours(d.getHours() + 1);
  return toLocalDatetimeValue(d);
}

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

  const existingEmails = new Set(existing.map((e) => e.email));

  const suggestions =
    query.trim().length >= 2
      ? [
          ...users
            .filter(
              (u) =>
                u.email &&
                !existingEmails.has(u.email) &&
                `${u.name ?? ""} ${u.email}`.toLowerCase().includes(query.toLowerCase()),
            )
            .slice(0, 5)
            .map((u) => ({
              key: `user-${u.id}`,
              label: u.name ?? u.email ?? "",
              sublabel: u.email ?? "",
              entry: {
                key: `user-${u.id}`,
                email: u.email!,
                name: u.name ?? u.email ?? "",
                userId: u.id,
              } as AttendeeEntry,
            })),
          ...contacts
            .filter(
              (c) =>
                c.email &&
                !existingEmails.has(c.email) &&
                `${c.firstName} ${c.lastName} ${c.email}`.toLowerCase().includes(query.toLowerCase()),
            )
            .slice(0, 5)
            .map((c) => ({
              key: `contact-${c.id}`,
              label: `${c.firstName} ${c.lastName}`,
              sublabel: c.email ?? "",
              entry: {
                key: `contact-${c.id}`,
                email: c.email!,
                name: `${c.firstName} ${c.lastName}`,
                contactId: c.id,
              } as AttendeeEntry,
            })),
        ]
      : [];

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setTab("search")}
          className={`rounded-full border px-3 py-1 text-xs transition-colors ${
            tab === "search"
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border text-muted-foreground hover:border-primary/50"
          }`}
        >
          Cerca
        </button>
        <button
          type="button"
          onClick={() => setTab("manual")}
          className={`rounded-full border px-3 py-1 text-xs transition-colors ${
            tab === "manual"
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border text-muted-foreground hover:border-primary/50"
          }`}
        >
          Inserimento manuale
        </button>
      </div>

      {tab === "search" && (
        <div className="relative">
          <Input
            placeholder="Nome, email..."
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
                  <div className="min-w-0">
                    <div className="truncate font-medium">{s.label}</div>
                    <div className="truncate text-muted-foreground text-xs">{s.sublabel}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "manual" && (
        <div className="flex gap-2">
          <Input
            placeholder="Nome"
            value={manualName}
            onChange={(e) => setManualName(e.target.value)}
            className="h-8 text-sm"
          />
          <Input
            placeholder="Email"
            type="email"
            value={manualEmail}
            onChange={(e) => setManualEmail(e.target.value)}
            className="h-8 text-sm"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 shrink-0 px-2"
            onClick={() => {
              if (!manualName.trim() || !manualEmail.trim()) return;
              if (existingEmails.has(manualEmail.trim())) {
                toast.error("Partecipante già aggiunto");
                return;
              }
              onAdd({
                key: `manual-${Date.now()}`,
                email: manualEmail.trim(),
                name: manualName.trim(),
              });
              setManualName("");
              setManualEmail("");
            }}
          >
            <UserPlus className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Main Dialog ──────────────────────────────────────────────────────────────

export function AppointmentDialog({ defaultDate, trigger }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startAt, setStartAt] = useState(defaultDate ?? defaultStart());
  const [endAt, setEndAt] = useState(defaultEnd(defaultDate ?? defaultStart()));
  const [location, setLocation] = useState("");
  const [conferenceType, setConferenceType] = useState<ConferenceType>("none");
  const [customLink, setCustomLink] = useState("");
  const [reminderMinutes, setReminderMinutes] = useState<number | null>(30);
  const [attendees, setAttendees] = useState<AttendeeEntry[]>([]);

  // Picker data (lazy loaded on open)
  const [internalUsers, setInternalUsers] = useState<InternalUser[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [pickersLoaded, setPickersLoaded] = useState(false);

  // Conflict check
  const [conflicts, setConflicts] = useState<{ id: string; title: string }[]>([]);

  // Availability checker
  const [showAvailability, setShowAvailability] = useState(false);

  const reset = useCallback(() => {
    setTitle("");
    setDescription("");
    const s = defaultDate ?? defaultStart();
    setStartAt(s);
    setEndAt(defaultEnd(s));
    setLocation("");
    setConferenceType("none");
    setCustomLink("");
    setReminderMinutes(30);
    setAttendees([]);
    setConflicts([]);
    setShowAvailability(false);
  }, [defaultDate]);

  // Load pickers on first open
  useEffect(() => {
    if (!open || pickersLoaded) return;
    Promise.all([getInternalUsers(), getContactsForPicker()]).then(([u, c]) => {
      setInternalUsers(u);
      setContacts(
        c.map((x) => ({
          id: x.id,
          firstName: x.firstName,
          lastName: x.lastName,
          email: x.email,
        })),
      );
      setPickersLoaded(true);
    });
  }, [open, pickersLoaded]);

  // Conflict detection
  useEffect(() => {
    if (!startAt || !endAt) return;
    const s = new Date(startAt);
    const e = new Date(endAt);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || s >= e) return;

    const timer = setTimeout(() => {
      getOverlappingAppointments(s, e).then(setConflicts);
    }, 600);
    return () => clearTimeout(timer);
  }, [startAt, endAt]);

  const handleStartChange = (v: string) => {
    setStartAt(v);
    if (v && endAt) {
      const s = new Date(v);
      const e = new Date(endAt);
      if (e <= s) {
        const newEnd = new Date(s);
        newEnd.setHours(newEnd.getHours() + 1);
        setEndAt(toLocalDatetimeValue(newEnd));
      }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error("Il titolo è obbligatorio");
      return;
    }
    if (!startAt || !endAt) {
      toast.error("Data e ora sono obbligatorie");
      return;
    }
    const s = new Date(startAt);
    const en = new Date(endAt);
    if (en <= s) {
      toast.error("La data di fine deve essere dopo quella di inizio");
      return;
    }

    startTransition(async () => {
      try {
        const result = await createAppointment({
          title: title.trim(),
          description: description.trim() || undefined,
          startAt: s,
          endAt: en,
          location: location.trim() || undefined,
          conferenceType: conferenceType !== "none" ? conferenceType : undefined,
          conferenceLink: conferenceType === "custom" ? customLink.trim() || undefined : undefined,
          autoGenerateLink: conferenceType === "jitsi",
          reminderMinutes: reminderMinutes ?? undefined,
          attendees: attendees.map(({ key: _k, ...a }) => a),
        });

        // Always confirm the appointment was saved
        toast.success("Appuntamento creato.");

        // Separate toast for invite outcome
        const { inviteStatus } = result;
        if (inviteStatus.noProvider) {
          toast.warning(
            "Nessun provider email configurato — gli inviti non sono stati inviati. Verifica le impostazioni email.",
            { duration: 6000 },
          );
        } else if (inviteStatus.sent > 0 && inviteStatus.failed === 0) {
          toast.success(
            inviteStatus.sent === 1
              ? "1 invito inviato con successo."
              : `${inviteStatus.sent} inviti inviati con successo.`,
          );
        } else if (inviteStatus.sent > 0 && inviteStatus.failed > 0) {
          toast.warning(
            `${inviteStatus.sent} invit${inviteStatus.sent === 1 ? "o inviato" : "i inviati"}, ${inviteStatus.failed} non consegnati.`,
            { duration: 6000 },
          );
        } else if (inviteStatus.failed > 0) {
          toast.error(
            `Impossibile inviare gli inviti (${inviteStatus.failed} error${inviteStatus.failed === 1 ? "e" : "i"}).`,
            { duration: 6000 },
          );
        }

        setOpen(false);
        reset();
        router.refresh();
      } catch {
        toast.error("Errore nella creazione dell'appuntamento");
      }
    });
  };

  return (
    <>
      {trigger ? (
        <button type="button" onClick={() => setOpen(true)} className="contents">
          {trigger}
        </button>
      ) : (
        <Button size="sm" variant="outline" className="shrink-0 gap-2" onClick={() => setOpen(true)}>
          <CalendarCheck className="h-4 w-4" />
          Nuovo appuntamento
        </Button>
      )}

      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) reset();
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarCheck className="h-5 w-5 text-amber-500" />
              Nuovo appuntamento
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-5 py-2">
            {/* Title */}
            <div className="space-y-1.5">
              <Label htmlFor="apt-title">Titolo *</Label>
              <Input
                id="apt-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Riunione con cliente…"
                autoFocus
              />
            </div>

            {/* Date / time row */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="apt-start" className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" /> Inizio *
                </Label>
                <input
                  id="apt-start"
                  type="datetime-local"
                  value={startAt}
                  onChange={(e) => handleStartChange(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="apt-end">Fine *</Label>
                <input
                  id="apt-end"
                  type="datetime-local"
                  value={endAt}
                  onChange={(e) => setEndAt(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
            </div>

            {/* Conflict warning */}
            {conflicts.length > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 dark:border-amber-800 dark:bg-amber-950/30">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <div className="text-amber-800 text-sm dark:text-amber-300">
                  <span className="font-semibold">Possibile sovrapposizione</span> con:{" "}
                  {conflicts.map((c) => c.title).join(", ")}
                </div>
              </div>
            )}

            {/* Location */}
            <div className="space-y-1.5">
              <Label htmlFor="apt-location" className="flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" /> Luogo (opzionale)
              </Label>
              <Input
                id="apt-location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Indirizzo fisico o URL…"
              />
            </div>

            {/* Conference */}
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <Video className="h-3.5 w-3.5" /> Videoconferenza
              </Label>
              <div className="flex gap-2">
                {(["none", "jitsi", "custom"] as ConferenceType[]).map((t) => {
                  const LABELS = { none: "Nessuna", jitsi: "Genera link Jitsi", custom: "Link personalizzato" };
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setConferenceType(t)}
                      className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-medium text-xs transition-all ${
                        conferenceType === t
                          ? "border-primary bg-primary/5 text-primary"
                          : "border-border text-muted-foreground hover:border-primary/40"
                      }`}
                    >
                      {t === "jitsi" && <Link2 className="h-3 w-3" />}
                      {LABELS[t]}
                    </button>
                  );
                })}
              </div>
              {conferenceType === "jitsi" && (
                <p className="flex items-center gap-1.5 text-muted-foreground text-xs">
                  <Check className="h-3 w-3 text-green-500" />
                  Un link Jitsi Meet verrà generato automaticamente e incluso nell'invito.
                </p>
              )}
              {conferenceType === "custom" && (
                <Input
                  value={customLink}
                  onChange={(e) => setCustomLink(e.target.value)}
                  placeholder="https://zoom.us/j/…"
                  className="text-sm"
                />
              )}
            </div>

            {/* Description / notes */}
            <div className="space-y-1.5">
              <Label htmlFor="apt-desc" className="flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5" /> Note / Descrizione
              </Label>
              <Textarea
                id="apt-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Agenda, argomenti da trattare…"
                rows={3}
                className="resize-none text-sm"
              />
            </div>

            {/* Reminder */}
            <div className="space-y-1.5">
              <Label htmlFor="apt-reminder">Promemoria</Label>
              <select
                id="apt-reminder"
                value={reminderMinutes ?? ""}
                onChange={(e) => setReminderMinutes(e.target.value ? Number(e.target.value) : null)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">Nessun promemoria</option>
                <option value="15">15 minuti prima</option>
                <option value="30">30 minuti prima</option>
                <option value="60">1 ora prima</option>
                <option value="120">2 ore prima</option>
                <option value="1440">1 giorno prima</option>
              </select>
            </div>

            {/* Participants */}
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5" /> Partecipanti
              </Label>

              {/* Added attendees */}
              {attendees.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {attendees.map((a) => (
                    <div
                      key={a.key}
                      className="flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs"
                    >
                      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-muted font-semibold">
                        {a.name.charAt(0).toUpperCase()}
                      </div>
                      <span className="font-medium">{a.name}</span>
                      <span className="text-muted-foreground">{a.email}</span>
                      {a.userId && (
                        <Badge variant="outline" className="h-4 px-1 py-0 text-[10px]">
                          interno
                        </Badge>
                      )}
                      <button
                        type="button"
                        onClick={() => setAttendees((prev) => prev.filter((x) => x.key !== a.key))}
                        className="ml-0.5 text-muted-foreground transition-colors hover:text-destructive"
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

              {attendees.length === 0 && (
                <p className="text-muted-foreground text-xs">
                  Nessun partecipante aggiunto. Puoi inviare inviti anche senza partecipanti.
                </p>
              )}
            </div>

            {/* Colleague availability */}
            {attendees.some((a) => a.userId) && (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setShowAvailability((prev) => !prev)}
                  className="flex w-full items-center justify-between rounded-lg border px-3 py-2 font-medium text-sm transition-colors hover:bg-muted/40"
                >
                  <span className="flex items-center gap-2">
                    <CalendarCheck className="h-3.5 w-3.5 text-amber-500" />
                    Verifica disponibilità colleghi
                  </span>
                  {showAvailability ? (
                    <ChevronUp className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>
                {showAvailability && (
                  <AvailabilityPicker
                    userIds={attendees.filter((a) => a.userId).map((a) => a.userId!)}
                    users={internalUsers}
                    date={startAt.split("T")[0]}
                    onSelect={(start, end) => {
                      setStartAt(start);
                      setEndAt(end);
                      setShowAvailability(false);
                    }}
                  />
                )}
              </div>
            )}

            <DialogFooter className="gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Annulla
              </Button>
              <Button type="submit" disabled={isPending} className="gap-2">
                {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                <CalendarCheck className="h-4 w-4" />
                Crea e invia inviti
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
