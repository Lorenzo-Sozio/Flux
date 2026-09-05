"use client";

import Link from "next/link";

import { AlarmClock, ArrowRight, CheckCircle2, Clock, FileWarning, Snowflake, TrendingDown, UserX } from "lucide-react";
import { useTranslations } from "next-intl";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
};

/**
 * The work list.
 *
 * The rest of this screen says what exists. This one says what to do about it
 * (audit rilievo S-02), which is the question a person actually opens the CRM
 * with on a Monday morning.
 */
export function NextActionsCard({ actions }: { actions: NextAction[] }) {
  const t = useTranslations("nextActions");

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{t("title")}</CardTitle>
        <CardDescription>{actions.length === 0 ? t("nothing") : t("count", { n: actions.length })}</CardDescription>
      </CardHeader>

      <CardContent className="pt-0">
        {actions.length === 0 ? (
          <div className="flex items-center gap-2 py-6 text-muted-foreground text-sm">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            <span>{t("allOnTrack")}</span>
          </div>
        ) : (
          <ul className="divide-y">
            {actions.map((a) => {
              const p = PRESENTATION[a.kind];
              return (
                <li key={`${a.entity}-${a.id}-${a.kind}`}>
                  <Link
                    href={a.href}
                    className="group -mx-2 flex items-start gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-muted/60"
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
                    <ArrowRight className="mt-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
