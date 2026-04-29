"use client";

import { useEffect, useState, useTransition } from "react";

import { useRouter } from "next/navigation";

import { format } from "date-fns";
import {
  AlertTriangle,
  CalendarCheck,
  CheckCircle2,
  Clock,
  HelpCircle,
  Loader2,
  Mail,
  MapPin,
  Timer,
  Trash2,
  Users,
  Video,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { cancelAppointment, getAppointmentById } from "@/actions/appointments";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";

type Appointment = NonNullable<Awaited<ReturnType<typeof getAppointmentById>>>;

const STATUS_CONFIG = {
  accepted: {
    label: "Accettato",
    icon: CheckCircle2,
    color: "text-green-600",
    bg: "bg-green-50 dark:bg-green-950/40",
    border: "border-green-200 dark:border-green-800",
  },
  declined: {
    label: "Rifiutato",
    icon: XCircle,
    color: "text-red-600",
    bg: "bg-red-50 dark:bg-red-950/40",
    border: "border-red-200 dark:border-red-800",
  },
  tentative: {
    label: "Forse",
    icon: HelpCircle,
    color: "text-amber-600",
    bg: "bg-amber-50 dark:bg-amber-950/40",
    border: "border-amber-200 dark:border-amber-800",
  },
  pending: {
    label: "In attesa",
    icon: Timer,
    color: "text-gray-500",
    bg: "bg-gray-50 dark:bg-gray-900",
    border: "border-gray-200 dark:border-gray-700",
  },
} as const;

export function AppointmentDetailSheet({
  appointmentId,
  closePath,
}: {
  appointmentId: string | null;
  closePath: string;
}) {
  const router = useRouter();
  const [appt, setAppt] = useState<Appointment | null>(null);
  const [loading, setLoading] = useState(false);
  const [isPending, startTransition] = useTransition();

  const handleClose = () => router.push(closePath);

  useEffect(() => {
    if (!appointmentId) {
      setAppt(null);
      return;
    }
    setLoading(true);
    getAppointmentById(appointmentId)
      .then(setAppt)
      .finally(() => setLoading(false));
  }, [appointmentId]);

  const handleCancel = () => {
    if (!appointmentId) return;
    startTransition(async () => {
      try {
        const result = await cancelAppointment(appointmentId);

        toast.success("Appuntamento annullato.");

        const { inviteStatus } = result;
        if (inviteStatus.noProvider) {
          toast.warning("Nessun provider email configurato — le notifiche di cancellazione non sono state inviate.", {
            duration: 6000,
          });
        } else if (inviteStatus.sent > 0 && inviteStatus.failed === 0) {
          toast.success(
            inviteStatus.sent === 1
              ? "1 notifica di cancellazione inviata."
              : `${inviteStatus.sent} notifiche di cancellazione inviate.`,
          );
        } else if (inviteStatus.sent > 0 && inviteStatus.failed > 0) {
          toast.warning(`${inviteStatus.sent} notifiche inviate, ${inviteStatus.failed} non consegnate.`, {
            duration: 6000,
          });
        } else if (inviteStatus.failed > 0) {
          toast.error(
            `Impossibile inviare le notifiche di cancellazione (${inviteStatus.failed} error${inviteStatus.failed === 1 ? "e" : "i"}).`,
            { duration: 6000 },
          );
        }

        handleClose();
      } catch {
        toast.error("Errore durante l'annullamento.");
      }
    });
  };

  const nonOrganizers = appt?.attendees.filter((a) => a.role !== "organizer") ?? [];
  const counts = {
    accepted: nonOrganizers.filter((a) => a.status === "accepted").length,
    declined: nonOrganizers.filter((a) => a.status === "declined").length,
    tentative: nonOrganizers.filter((a) => a.status === "tentative").length,
    pending: nonOrganizers.filter((a) => a.status === "pending").length,
    total: nonOrganizers.length,
  };

  return (
    <Sheet
      open={!!appointmentId}
      onOpenChange={(v) => {
        if (!v) handleClose();
      }}
    >
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-md">
        {/* Header */}
        <SheetHeader className="border-b bg-amber-50 px-5 py-4 dark:bg-amber-950/20">
          <div className="flex items-center gap-2 pr-8">
            <CalendarCheck className="h-5 w-5 shrink-0 text-amber-500" />
            <SheetTitle className="font-semibold text-base leading-snug">
              {loading ? "Caricamento…" : (appt?.title ?? "Appuntamento")}
            </SheetTitle>
          </div>
          {appt && (
            <div className="mt-1 flex items-center gap-1.5 text-muted-foreground text-xs">
              <Clock className="h-3.5 w-3.5" />
              <span>
                {format(appt.startAt, "d MMM yyyy, HH:mm")} – {format(appt.endAt, "HH:mm")}
              </span>
            </div>
          )}
        </SheetHeader>

        {/* Loading */}
        {loading && (
          <div className="flex flex-1 items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Content */}
        {!loading && appt && (
          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
            {/* Cancelled banner */}
            {appt.status === "cancelled" && (
              <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-red-700 text-sm dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                Questo appuntamento è stato annullato.
              </div>
            )}

            {/* Location / conference */}
            {(appt.conferenceLink ?? appt.location) && (
              <div className="flex items-start gap-2 text-sm">
                {appt.conferenceLink ? (
                  <Video className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                {appt.conferenceLink ? (
                  <a
                    href={appt.conferenceLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="break-all text-primary hover:underline"
                  >
                    {appt.conferenceLink}
                  </a>
                ) : (
                  <span>{appt.location}</span>
                )}
              </div>
            )}

            {/* Description */}
            {appt.description && (
              <p className="whitespace-pre-wrap rounded-lg bg-muted/40 px-3 py-2.5 text-muted-foreground text-sm">
                {appt.description}
              </p>
            )}

            {/* RSVP tracking */}
            {counts.total > 0 ? (
              <div className="space-y-3">
                <div className="flex items-center gap-1.5 font-semibold text-sm">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  Partecipanti ({counts.total})
                </div>

                {/* Summary counters */}
                <div className="grid grid-cols-4 gap-2">
                  {(["accepted", "declined", "tentative", "pending"] as const).map((s) => {
                    const cfg = STATUS_CONFIG[s];
                    const Icon = cfg.icon;
                    return (
                      <div
                        key={s}
                        className={`flex flex-col items-center gap-1 rounded-lg border p-2.5 ${cfg.bg} ${cfg.border}`}
                      >
                        <Icon className={`h-4 w-4 ${cfg.color}`} />
                        <span className={`font-bold text-xl tabular-nums leading-none ${cfg.color}`}>{counts[s]}</span>
                        <span className="text-center text-[10px] text-muted-foreground leading-tight">{cfg.label}</span>
                      </div>
                    );
                  })}
                </div>

                {/* Acceptance progress bar */}
                {counts.accepted > 0 && (
                  <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-green-500 transition-all"
                      style={{ width: `${(counts.accepted / counts.total) * 100}%` }}
                    />
                  </div>
                )}

                {/* Per-attendee rows */}
                <div className="space-y-1.5">
                  {nonOrganizers.map((a) => {
                    const cfg = STATUS_CONFIG[a.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.pending;
                    const Icon = cfg.icon;
                    return (
                      <div key={a.id} className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted font-semibold text-sm">
                          {a.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium text-sm">{a.name}</div>
                          <div className="flex items-center gap-1 truncate text-muted-foreground text-xs">
                            <Mail className="h-3 w-3 shrink-0" />
                            {a.email}
                          </div>
                        </div>
                        <div className={`flex shrink-0 items-center gap-1 font-medium text-xs ${cfg.color}`}>
                          <Icon className="h-3.5 w-3.5" />
                          {cfg.label}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">Nessun partecipante esterno.</p>
            )}
          </div>
        )}

        {/* Footer: cancel action */}
        {appt && appt.status !== "cancelled" && (
          <SheetFooter className="border-t">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" className="w-full gap-2" disabled={isPending}>
                  {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  Annulla appuntamento
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Annullare l'appuntamento?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Tutti i partecipanti riceveranno una notifica di cancellazione via email. Questa azione non è
                    reversibile.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>No, torna indietro</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleCancel}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Sì, annulla
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
