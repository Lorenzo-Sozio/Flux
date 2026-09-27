"use client";

import Link from "next/link";

import { Gauge } from "lucide-react";
import { useTranslations } from "next-intl";

import { PeriodNav } from "@/components/crm/period-nav";
import { RecordCards, ResponsiveRecordList } from "@/components/crm/record-cards";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCurrency } from "@/hooks/use-currency";
import { UNASSIGNED } from "@/lib/pipeline-filters";
import type { ScorecardRow } from "@/lib/rep-scorecard";

/**
 * The scorecard: who won what against which target, and what they did to get there.
 *
 * ⚠️ A number that counts deals is a link to exactly those deals — the board with the same
 * owner, status and calendar period (`closed=`). A figure nobody can open is a figure
 * nobody can check, and the first thing a manager does with a surprising one is open it.
 */
export function ScorecardClient({
  data,
  today,
}: {
  data: { period: string; rows: ScorecardRow[]; totals: ScorecardRow };
  /** This month on the workspace's clock: where "today" goes. */
  today: string;
}) {
  const t = useTranslations("reports.scorecard");
  const { formatAmount } = useCurrency();
  const money = (n: number) => formatAmount(n, { noDecimals: true });

  const href = (period: string) => `/dashboard/reports/scorecard?period=${period}`;

  const deals = (row: ScorecardRow, status: "won" | "lost" | "open") => {
    const q = new URLSearchParams({ owners: row.ownerId === "total" ? "all" : row.ownerId, status });
    // The scorecard counts every pipeline, so the list it opens shows every pipeline too.
    q.set("pipeline", "all");
    if (status !== "open") q.set("closed", data.period);
    return `/dashboard/pipeline?${q.toString()}`;
  };
  const name = (row: ScorecardRow) =>
    row.ownerId === UNASSIGNED ? t("unassigned") : row.former ? t("former", { name: row.name }) : row.name;
  const pct = (n: number | null) => (n === null ? "—" : `${n}%`);

  const cells = (row: ScorecardRow) => ({
    won: (
      <Link href={deals(row, "won")} className="font-medium tabular-nums hover:underline">
        {money(row.wonValue)}
        <span className="ml-1 text-muted-foreground text-xs">({row.won})</span>
      </Link>
    ),
    target:
      row.target === null ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <span className="tabular-nums">
          {money(row.target)}
          <span className="ml-1 text-muted-foreground text-xs">{pct(row.attainment)}</span>
        </span>
      ),
    coverage: row.coverage === null ? "—" : t("coverageValue", { value: row.coverage }),
    lost: (
      <Link href={deals(row, "lost")} className="tabular-nums hover:underline">
        {row.lost}
      </Link>
    ),
    winRate: pct(row.winRate),
    avgWon: row.avgWon === null ? "—" : money(row.avgWon),
    cycle: row.cycleDays === null ? "—" : t("days", { days: row.cycleDays }),
    open: (
      <Link href={deals(row, "open")} className="tabular-nums hover:underline">
        {money(row.openValue)}
        <span className="ml-1 text-muted-foreground text-xs">({row.open})</span>
      </Link>
    ),
    activity: t("activityValue", { calls: row.calls, meetings: row.meetings, emails: row.emails }),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 font-bold text-2xl tracking-tight">
          <Gauge className="h-6 w-6 text-primary" aria-hidden />
          {t("title")}
        </h1>
        <p className="mt-1 text-muted-foreground text-sm">{t("subtitle")}</p>
      </div>

      <PeriodNav period={data.period} today={today} href={href} />

      <Card className="border-0 shadow-sm">
        <CardContent className="p-0">
          {data.rows.length === 0 ? (
            <p className="px-6 py-8 text-center text-muted-foreground text-sm">{t("empty")}</p>
          ) : (
            <ResponsiveRecordList
              cards={
                <RecordCards
                  className="p-4"
                  items={[...data.rows, data.totals].map((row) => {
                    const c = cells(row);
                    return {
                      id: row.ownerId,
                      title: row.ownerId === "total" ? t("total") : name(row),
                      badge: <span className="font-semibold text-xs tabular-nums">{pct(row.attainment)}</span>,
                      fields: [
                        { label: t("cols.won"), value: c.won },
                        { label: t("cols.target"), value: c.target },
                        { label: t("cols.coverage"), value: c.coverage },
                        { label: t("cols.winRate"), value: c.winRate },
                        { label: t("cols.lost"), value: c.lost },
                        { label: t("cols.avgWon"), value: c.avgWon },
                        { label: t("cols.cycle"), value: c.cycle },
                        { label: t("cols.open"), value: c.open },
                        { label: t("cols.activity"), value: c.activity },
                      ],
                    };
                  })}
                />
              }
              table={
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead className="font-semibold text-xs">{t("cols.rep")}</TableHead>
                      <TableHead className="text-right font-semibold text-xs">{t("cols.won")}</TableHead>
                      <TableHead className="text-right font-semibold text-xs">{t("cols.target")}</TableHead>
                      <TableHead className="text-right font-semibold text-xs" title={t("coverageHelp")}>
                        {t("cols.coverage")}
                      </TableHead>
                      <TableHead className="text-right font-semibold text-xs">{t("cols.winRate")}</TableHead>
                      <TableHead className="text-right font-semibold text-xs">{t("cols.lost")}</TableHead>
                      <TableHead className="text-right font-semibold text-xs">{t("cols.avgWon")}</TableHead>
                      <TableHead className="text-right font-semibold text-xs" title={t("cycleHelp")}>
                        {t("cols.cycle")}
                      </TableHead>
                      <TableHead className="text-right font-semibold text-xs" title={t("openHelp")}>
                        {t("cols.open")}
                      </TableHead>
                      <TableHead className="text-right font-semibold text-xs">{t("cols.activity")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.rows.map((row) => {
                      const c = cells(row);
                      return (
                        <TableRow key={row.ownerId}>
                          <TableCell className="font-medium text-sm">{name(row)}</TableCell>
                          <TableCell className="text-right text-sm">{c.won}</TableCell>
                          <TableCell className="text-right text-sm">{c.target}</TableCell>
                          <TableCell className="text-right text-sm tabular-nums">{c.coverage}</TableCell>
                          <TableCell className="text-right text-sm tabular-nums">{c.winRate}</TableCell>
                          <TableCell className="text-right text-sm">{c.lost}</TableCell>
                          <TableCell className="text-right text-sm tabular-nums">{c.avgWon}</TableCell>
                          <TableCell className="text-right text-sm tabular-nums">{c.cycle}</TableCell>
                          <TableCell className="text-right text-sm">{c.open}</TableCell>
                          <TableCell className="text-right text-muted-foreground text-xs tabular-nums">
                            {c.activity}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                  <TableFooter>
                    {(() => {
                      const c = cells(data.totals);
                      return (
                        <TableRow>
                          <TableCell className="font-semibold text-sm">{t("total")}</TableCell>
                          <TableCell className="text-right text-sm">{c.won}</TableCell>
                          <TableCell className="text-right text-sm">{c.target}</TableCell>
                          <TableCell className="text-right text-sm tabular-nums">{c.coverage}</TableCell>
                          <TableCell className="text-right text-sm tabular-nums">{c.winRate}</TableCell>
                          <TableCell className="text-right text-sm">{c.lost}</TableCell>
                          <TableCell className="text-right text-sm tabular-nums">{c.avgWon}</TableCell>
                          <TableCell className="text-right text-sm tabular-nums">{c.cycle}</TableCell>
                          <TableCell className="text-right text-sm">{c.open}</TableCell>
                          <TableCell className="text-right text-muted-foreground text-xs tabular-nums">
                            {c.activity}
                          </TableCell>
                        </TableRow>
                      );
                    })()}
                  </TableFooter>
                </Table>
              }
            />
          )}
        </CardContent>
      </Card>

      <p className="text-muted-foreground text-xs">{t("footnote")}</p>
    </div>
  );
}
