"use client";

import { useState, useTransition } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  AlarmClock,
  AlertTriangle,
  CalendarPlus,
  CalendarX2,
  CheckCircle2,
  Clock,
  FileWarning,
  ListStart,
  MoreHorizontal,
  Reply,
  ShoppingCart,
  Snowflake,
  TrendingDown,
  UserX,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { snoozeNextActionAction } from "@/actions/next-actions";
import { type FollowUpTarget, PlanFollowUpDialog } from "@/components/crm/plan-follow-up-dialog";
import { TaskOutcomeDialog } from "@/components/crm/task-outcome-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { NextAction, NextActionKind } from "@/lib/next-actions";

/**
 * How each kind reads on the screen.
 *
 * The label is the verb, not the condition: the list is meant to be worked
 * through, and "chase this quote" is a thing a person can do, where "quote
 * unopened for five days" is a thing a person has to interpret first.
 */
const PRESENTATION: Record<NextActionKind, { key: string; icon: React.ReactNode; tone: string }> = {
  sla_breached: {
    key: "slaBreached",
    icon: <AlarmClock className="h-4 w-4" />,
    tone: "text-red-600 bg-red-50 dark:bg-red-950/40 dark:text-red-400",
  },
  sla_at_risk: {
    key: "slaAtRisk",
    icon: <Clock className="h-4 w-4" />,
    tone: "text-orange-600 bg-orange-50 dark:bg-orange-950/40 dark:text-orange-400",
  },
  quote_expiring: {
    key: "quoteExpiring",
    icon: <FileWarning className="h-4 w-4" />,
    tone: "text-amber-600 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-400",
  },
  deal_overdue: {
    key: "dealOverdue",
    icon: <TrendingDown className="h-4 w-4" />,
    tone: "text-violet-600 bg-violet-50 dark:bg-violet-950/40 dark:text-violet-400",
  },
  quote_unopened: {
    key: "quoteUnopened",
    icon: <FileWarning className="h-4 w-4" />,
    tone: "text-blue-600 bg-blue-50 dark:bg-blue-950/40 dark:text-blue-400",
  },
  lead_untouched: {
    key: "leadUntouched",
    icon: <UserX className="h-4 w-4" />,
    tone: "text-teal-600 bg-teal-50 dark:bg-teal-950/40 dark:text-teal-400",
  },
  deal_stalled: {
    key: "dealStalled",
    icon: <TrendingDown className="h-4 w-4" />,
    tone: "text-slate-600 bg-slate-100 dark:bg-slate-800 dark:text-slate-300",
  },
  customer_quiet: {
    key: "customerQuiet",
    icon: <Snowflake className="h-4 w-4" />,
    tone: "text-sky-600 bg-sky-50 dark:bg-sky-950/40 dark:text-sky-400",
  },
  deal_no_next_step: {
    key: "dealNoNextStep",
    icon: <CalendarX2 className="h-4 w-4" />,
    tone: "text-amber-600 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-400",
  },
  reply_due: {
    key: "replyDue",
    icon: <Reply className="h-4 w-4" />,
    tone: "text-rose-600 bg-rose-50 dark:bg-rose-950/40 dark:text-rose-400",
  },
  quote_to_order: {
    key: "quoteToOrder",
    icon: <ShoppingCart className="h-4 w-4" />,
    tone: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-400",
  },
};

const SNOOZES = [
  { days: 1, key: "snoozeTomorrow" },
  { days: 3, key: "snooze3" },
  { days: 7, key: "snoozeWeek" },
] as const;

/**
 * The work list.
 *
 * The rest of this screen says what exists. This one says what to do about it
 * (audit rilievo S-02), which is the question a person actually opens the CRM
 * with on a Monday morning.
 */
export function NextActionsCard({
  actions: initial,
  failed = false,
  canWrite = false,
}: {
  actions: NextAction[];
  failed?: boolean;
  /** Planning a follow-up writes a task: not offered to a viewer. Snoozing is personal. */
  canWrite?: boolean;
}) {
  const t = useTranslations("nextActions");
  const router = useRouter();
  const [actions, setActions] = useState(initial);
  const [planning, setPlanning] = useState<{ action: NextAction; target: FollowUpTarget } | null>(null);
  const [replying, setReplying] = useState<NextAction | null>(null);
  const [, startTransition] = useTransition();

  // ⚠️ Worked from where it is: each row can be planned, answered or put aside without
  // opening the record, which was the only thing the list used to allow.
  const drop = (a: NextAction) => setActions((prev) => prev.filter((x) => !(x.kind === a.kind && x.id === a.id)));
  const snooze = (a: NextAction, days: number) =>
    startTransition(async () => {
      try {
        await snoozeNextActionAction(a.kind, a.id, days);
        drop(a);
        toast.success(t("snoozed", { days }));
      } catch {
        toast.error(t("actionFailed"));
      }
    });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
        <div className="min-w-0 space-y-1.5">
          <CardTitle className="text-base">{t("title")}</CardTitle>
          <CardDescription>{actions.length === 0 ? t("nothing") : t("count", { n: actions.length })}</CardDescription>
        </div>
        {/* One at a time, with the number to call and the outcome form (§3.3). */}
        {actions.length > 0 && (
          <Button asChild size="sm" variant="outline" className="shrink-0">
            <Link href="/dashboard/queue">
              <ListStart className="size-4 sm:mr-1.5" aria-hidden />
              <span className="max-sm:sr-only">{t("startQueue")}</span>
            </Link>
          </Button>
        )}
      </CardHeader>

      <CardContent className="pt-0">
        {failed ? (
          // ⚠️ An empty list and a failed one look identical, and one of them says
          // "you are up to date" when nobody knows whether you are. A work list
          // that cannot be built has to say so, or it is worse than not being there.
          <div className="flex items-center gap-2 py-6 text-amber-700 text-sm dark:text-amber-400">
            <AlertTriangle className="h-4 w-4" />
            <span>{t("failed")}</span>
          </div>
        ) : actions.length === 0 ? (
          <div className="flex items-center gap-2 py-6 text-muted-foreground text-sm">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            <span>{t("allOnTrack")}</span>
          </div>
        ) : (
          <ul className="divide-y">
            {actions.map((a) => {
              const p = PRESENTATION[a.kind];
              const followUp = a.followUp;
              return (
                <li key={`${a.entity}-${a.id}-${a.kind}`} className="-mx-2 flex items-start gap-1">
                  <Link
                    href={a.href}
                    className="flex min-w-0 flex-1 items-start gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-muted/60"
                  >
                    <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${p.tone}`}>
                      {p.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-sm">{a.title}</span>
                      <span className="block truncate text-muted-foreground text-xs">
                        {t(p.key)} · {t(a.detailKey, { n: a.detailValue })}
                      </span>
                    </span>
                  </Link>
                  {/* Always drawn: a phone has no hover to reveal it. */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="mt-1.5 size-9 shrink-0 sm:size-8"
                        aria-label={t("rowActions", { title: a.title })}
                      >
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {a.taskId && canWrite && (
                        <DropdownMenuItem onSelect={() => setReplying(a)}>
                          <CheckCircle2 className="size-4" aria-hidden />
                          {t("replied")}
                        </DropdownMenuItem>
                      )}
                      {followUp && canWrite && (
                        <DropdownMenuItem onSelect={() => setPlanning({ action: a, target: followUp })}>
                          <CalendarPlus className="size-4" aria-hidden />
                          {t("planFollowUp")}
                        </DropdownMenuItem>
                      )}
                      {((a.taskId && canWrite) || (followUp && canWrite)) && <DropdownMenuSeparator />}
                      {SNOOZES.map(({ days, key }) => (
                        <DropdownMenuItem key={days} onSelect={() => snooze(a, days)}>
                          <Clock className="size-4" aria-hidden />
                          {t(key)}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
      {planning && (
        <PlanFollowUpDialog
          target={planning.target}
          title={planning.action.title}
          open
          onOpenChange={(v) => {
            if (!v) setPlanning(null);
          }}
          onPlanned={() => {
            // A deal with a step planned is no longer "nothing planned"; the other rows are
            // for the server to reconsider.
            if (planning.action.kind === "deal_no_next_step") drop(planning.action);
            router.refresh();
          }}
        />
      )}
      {replying?.taskId && (
        <TaskOutcomeDialog
          task={{ id: replying.taskId, title: replying.title, type: "email" }}
          open
          onOpenChange={(v) => {
            if (!v) setReplying(null);
          }}
          revalidate="/dashboard/crm"
          onCompleted={() => drop(replying)}
        />
      )}
    </Card>
  );
}
