"use client";

import { Swords, Trophy, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useCurrency } from "@/hooks/use-currency";

interface Row {
  key: string;
  count: number;
  value: number;
}

export interface WinLossAnalysis {
  wonCount: number;
  wonValue: number;
  lostCount: number;
  lostValue: number;
  winRate: number;
  byReason: Row[];
  byStage: Row[];
  byCompetitor: Row[];
}

/** A breakdown, drawn as a bar per row so the shape reads before the numbers do. */
function Breakdown({
  title,
  description,
  rows,
  empty,
  format,
}: {
  title: string;
  description: string;
  rows: Row[];
  empty: string;
  format: (n: number) => string;
}) {
  const largest = rows.reduce((max, r) => Math.max(max, r.value), 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-4 text-muted-foreground text-sm">{empty}</p>
        ) : (
          <ul className="space-y-3">
            {rows.map((r) => (
              <li key={r.key}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate font-medium">{r.key}</span>
                  <span className="shrink-0 text-muted-foreground tabular-nums">
                    {format(r.value)} · {r.count}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-rose-400/80"
                    style={{ width: `${largest > 0 ? Math.max(2, (r.value / largest) * 100) : 0}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The figures, on the client, for the one reason the siblings do the same: money
 * has to be shown in the currency the workspace chose, and that lives in a
 * context a server component cannot read. This page formatted everything as euro
 * whatever the setting said.
 */
export function WinLossFigures({ analysis }: { analysis: WinLossAnalysis }) {
  const t = useTranslations("pipeline.winLoss");
  const { formatAmount } = useCurrency();

  const averageLoss = analysis.lostCount ? analysis.lostValue / analysis.lostCount : 0;

  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 font-medium text-muted-foreground text-sm">
              <Trophy className="h-4 w-4 text-emerald-500" /> {t("won")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-bold text-2xl tabular-nums">{formatAmount(analysis.wonValue)}</div>
            <p className="mt-1 text-muted-foreground text-xs">{t("dealsCount", { count: analysis.wonCount })}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 font-medium text-muted-foreground text-sm">
              <XCircle className="h-4 w-4 text-rose-500" /> {t("lost")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-bold text-2xl tabular-nums">{formatAmount(analysis.lostValue)}</div>
            <p className="mt-1 text-muted-foreground text-xs">{t("dealsCount", { count: analysis.lostCount })}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 font-medium text-muted-foreground text-sm">
              <Swords className="h-4 w-4 text-violet-500" /> {t("winRate")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-bold text-2xl tabular-nums">{analysis.winRate}%</div>
            {/* Of what closed. Open deals are not losses, and counting them as
                such is how a win rate quietly stops meaning anything. */}
            <p className="mt-1 text-muted-foreground text-xs">{t("ofClosed")}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="font-medium text-muted-foreground text-sm">{t("averageLoss")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-bold text-2xl tabular-nums">{formatAmount(averageLoss)}</div>
            <p className="mt-1 text-muted-foreground text-xs">{t("perLostDeal")}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Breakdown
          title={t("whyTitle")}
          description={t("whyDescription")}
          rows={analysis.byReason}
          empty={t("whyEmpty")}
          format={formatAmount}
        />
        <Breakdown
          title={t("whereTitle")}
          description={t("whereDescription")}
          rows={analysis.byStage}
          empty={t("nothingYet")}
          format={formatAmount}
        />
        <Breakdown
          title={t("whoTitle")}
          description={t("whoDescription")}
          rows={analysis.byCompetitor}
          empty={t("nothingYet")}
          format={formatAmount}
        />
      </div>
    </>
  );
}
