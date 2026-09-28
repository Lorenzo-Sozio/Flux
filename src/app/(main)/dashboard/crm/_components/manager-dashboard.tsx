import Link from "next/link";

import { ArrowRight, CalendarX2Icon, PercentIcon, TrendingUpIcon, TrophyIcon, UsersIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { getRepScorecard } from "@/actions/reports";
import { Money } from "@/components/crm/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { countOpenDealsWithoutNextStep } from "@/lib/deal-signals";
import { UNASSIGNED } from "@/lib/pipeline-filters";
import { getDb } from "@/lib/tenant-context";

import { KPI_VALUE, Kpi } from "./kpi";

/**
 * The sales manager's home: the team, this month, on the workspace's clock.
 *
 * The scorecard's own figures (src/lib/rep-scorecard.ts), so this and the scorecard
 * page can never disagree, plus the one number the scorecard does not carry: how many
 * of the team's open deals have nothing planned. Five statements in all.
 */
export async function ManagerDashboard() {
  const t = await getTranslations("crm.dashboards.manager");
  const db = await getDb();
  const [card, bare] = await Promise.all([
    getRepScorecard().catch(() => null),
    countOpenDealsWithoutNextStep(db, null).catch(() => 0),
  ]);
  const totals = card?.totals;
  const period = card?.period ?? "";
  const rows = (card?.rows ?? [])
    .filter((r) => r.wonValue > 0 || r.openValue > 0 || r.target)
    .sort((a, b) => b.wonValue - a.wonValue || b.openValue - a.openValue);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:gap-6 xl:grid-cols-4">
        <Kpi
          // The deals it adds up: everybody's, won, closed this month.
          href={`/dashboard/pipeline?owners=all&status=won&closed=${period}&pipeline=all`}
          accent="border-l-emerald-500"
          title={t("won")}
          icon={<TrophyIcon className="h-4 w-4 shrink-0 text-emerald-500" />}
        >
          <div className={KPI_VALUE}>
            <Money value={totals?.wonValue ?? 0} />
          </div>
          <p className="mt-1 text-muted-foreground text-xs">
            {totals?.target ? (
              <>
                {t("wonOf")} <Money value={totals.target} />
                {totals.attainment !== null && ` · ${totals.attainment}%`}
              </>
            ) : (
              t("noTarget")
            )}
          </p>
        </Kpi>
        <Kpi
          href="/dashboard/pipeline?owners=all&status=open&pipeline=all"
          accent="border-l-blue-500"
          title={t("open")}
          icon={<TrendingUpIcon className="h-4 w-4 shrink-0 text-blue-500" />}
        >
          <div className={KPI_VALUE}>
            <Money value={totals?.openValue ?? 0} />
          </div>
          <p className="mt-1 text-muted-foreground text-xs">{t("openDesc", { count: totals?.open ?? 0 })}</p>
        </Kpi>
        <Kpi
          href="/dashboard/pipeline?owners=all&status=open&pipeline=all"
          accent={bare > 0 ? "border-l-red-500" : "border-l-slate-300"}
          title={t("bare")}
          icon={
            <CalendarX2Icon className={`h-4 w-4 shrink-0 ${bare > 0 ? "text-red-500" : "text-muted-foreground"}`} />
          }
        >
          <div className={KPI_VALUE}>{bare}</div>
          <p className="mt-1 text-muted-foreground text-xs">{t("bareDesc")}</p>
        </Kpi>
        <Kpi
          href="/dashboard/pipeline/win-loss"
          accent="border-l-violet-500"
          title={t("winRate")}
          icon={<PercentIcon className="h-4 w-4 shrink-0 text-violet-500" />}
        >
          <div className={KPI_VALUE}>
            {totals?.winRate !== null && totals?.winRate !== undefined ? `${totals.winRate}%` : "—"}
          </div>
          <p className="mt-1 text-muted-foreground text-xs">
            {totals ? t("winRateDesc", { won: totals.won, lost: totals.lost }) : t("noData")}
          </p>
        </Kpi>
      </div>

      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <UsersIcon className="h-4 w-4 text-muted-foreground" />
              {t("teamTitle")}
            </CardTitle>
            <CardDescription>{t("teamDesc")}</CardDescription>
          </div>
          <Button variant="outline" size="sm" className="shrink-0 gap-1" asChild>
            <Link href="/dashboard/reports/scorecard">
              {t("viewScorecard")} <ArrowRight className="h-3 w-3" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="px-6 py-8 text-center text-muted-foreground text-sm">{t("empty")}</p>
          ) : (
            <ul className="divide-y">
              {rows.map((r) => (
                <li key={r.ownerId}>
                  <Link
                    href={`/dashboard/pipeline?owners=${r.ownerId}&pipeline=all`}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40 sm:px-6"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-sm">
                        {r.ownerId === UNASSIGNED ? t("unassigned") : r.name}
                      </p>
                      <p className="truncate text-muted-foreground text-xs">
                        {t("rowOpen")} <Money value={r.openValue} />
                        {r.winRate !== null && ` · ${t("rowWinRate", { rate: r.winRate })}`}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-semibold text-sm tabular-nums">
                        <Money value={r.wonValue} />
                      </p>
                      <p className="text-muted-foreground text-xs tabular-nums">
                        {r.attainment !== null ? t("rowAttainment", { pct: r.attainment }) : t("rowNoTarget")}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
