import Link from "next/link";

import { AlarmClock, ArrowRight, Headphones, Inbox } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";

import { getNextActions } from "@/actions/next-actions";
import { getTodayView } from "@/actions/today";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getActor } from "@/lib/auth-guard";
import { requirePageCapability } from "@/lib/page-guard";

import { AgendaWidget } from "../crm/_components/agenda-widget";
import { NextActionsCard } from "../crm/_components/next-actions-card";

/** How long is left, said the way a person would say it. */
function timeLeft(
  deadline: Date | null,
  t: Awaited<ReturnType<typeof getTranslations<"today">>>,
): { text: string; late: boolean } | null {
  if (!deadline) return null;
  const ms = new Date(deadline).getTime() - Date.now();
  const late = ms < 0;

  const mins = Math.round(Math.abs(ms) / 60_000);
  if (mins < 60) return { text: t(late ? "minutesLate" : "minutesLeft", { n: mins }), late };
  const hours = Math.round(mins / 60);
  if (hours < 24) return { text: t(late ? "hoursLate" : "hoursLeft", { n: hours }), late };
  const days = Math.round(hours / 24);
  return { text: t(late ? "daysLate" : "daysLeft", { n: days }), late };
}

const PRIORITY_CLASS: Record<string, string> = {
  urgent: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300",
  high: "bg-orange-100 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300",
  normal: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  low: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
};

/**
 * Today.
 *
 * Thirteen modules in the sidebar are the shape of the product, not the shape of
 * a working day (audit rilievo S-11). Somebody arriving in the morning wants one
 * screen: what is happening today, what is waiting on them, and what is about to
 * miss its promise — and to act on any of it without going and finding the module
 * it lives in.
 *
 * Nothing here is new data. The agenda is the one the dashboard already draws,
 * moved into a shared action so there is one of it; the work list is the rules
 * from S-02; the tickets are the person's own queue, ordered by when they stop
 * being on time.
 */
export default async function TodayPage() {
  await requirePageCapability("record:read");

  const locale = await getLocale();
  const actor = await getActor();
  const firstName = actor?.name?.split(" ")[0];

  const [{ agenda, tickets }, nextActions, t] = await Promise.all([
    getTodayView(),
    getNextActions(10).catch(() => null),
    getTranslations("today"),
  ]);

  const now = new Date();
  const dayLabel = now.toLocaleDateString(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const greeting = t(
    now.getHours() < 12 ? "greetingMorning" : now.getHours() < 18 ? "greetingAfternoon" : "greetingEvening",
  );

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="font-bold text-2xl tracking-tight">
          {greeting}
          {firstName ? `, ${firstName}` : ""}
        </h1>
        <p className="mt-0.5 text-muted-foreground capitalize">{dayLabel}</p>
      </div>

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-3">
        {/* The day itself, given the room it needs. */}
        <div className="xl:col-span-2">
          <AgendaWidget items={agenda} dateLabel={dayLabel} />
        </div>

        <div className="flex flex-col gap-5">
          <NextActionsCard actions={nextActions ?? []} failed={nextActions === null} />

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Headphones className="h-4 w-4 text-muted-foreground" />
                {t("ticketsTitle")}
              </CardTitle>
              <CardDescription>{tickets.length === 0 ? t("ticketsNothing") : t("ticketsSoonest")}</CardDescription>
            </CardHeader>

            <CardContent className="pt-0">
              {tickets.length === 0 ? (
                <div className="flex items-center gap-2 py-6 text-muted-foreground text-sm">
                  <Inbox className="h-4 w-4" />
                  <span>{t("ticketsEmpty")}</span>
                </div>
              ) : (
                <ul className="divide-y">
                  {tickets.map((ticket) => {
                    const left = timeLeft(ticket.slaDeadlineAt, t);
                    return (
                      <li key={ticket.id}>
                        <Link
                          href={`/dashboard/support/tickets/${ticket.id}`}
                          className="group -mx-2 flex items-start gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-muted/60"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="font-mono text-muted-foreground text-xs">{ticket.ticketNumber}</span>
                              <Badge
                                variant="outline"
                                className={`h-4 border-0 px-1.5 text-[10px] ${PRIORITY_CLASS[ticket.priority] ?? PRIORITY_CLASS.normal}`}
                              >
                                {ticket.priority}
                              </Badge>
                            </span>
                            <span className="mt-0.5 block truncate text-sm">{ticket.subject}</span>
                            {left && (
                              <span
                                className={`mt-0.5 flex items-center gap-1 text-xs ${
                                  left.late ? "text-red-600 dark:text-red-400" : "text-muted-foreground"
                                }`}
                              >
                                <AlarmClock className="h-3 w-3" />
                                {left.text}
                              </span>
                            )}
                          </span>
                          <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
