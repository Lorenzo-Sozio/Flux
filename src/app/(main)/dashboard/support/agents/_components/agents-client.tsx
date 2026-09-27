"use client";

import Link from "next/link";

import { Users } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import type { SupportAgentReport } from "@/actions/support-report";
import { PeriodNav } from "@/components/crm/period-nav";
import { RecordCards, ResponsiveRecordList } from "@/components/crm/record-cards";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type AgentFigures, csatScore, PRIORITIES, type Ratio, ratio } from "@/lib/support-metrics";

/**
 * The desk by person. Every figure says in its heading's tooltip what it counts, because
 * each has an easy wrong version (src/lib/support-metrics.ts).
 */
export function AgentsClient({ data, today }: { data: SupportAgentReport; today: string }) {
  const t = useTranslations("support.agents");
  const locale = useLocale();
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const href = (period: string) => `/dashboard/support/agents?period=${period}`;

  const duration = (minutes: number | null) => {
    if (minutes === null) return "—";
    if (minutes < 60) return t("minutes", { n: number.format(Math.round(minutes)) });
    if (minutes < 60 * 24) return t("hours", { n: number.format(minutes / 60) });
    return t("days", { n: number.format(minutes / 60 / 24) });
  };
  const share = (r: Ratio) => {
    const v = ratio(r);
    return v === null ? "—" : `${Math.round(v * 100)}%`;
  };
  const csat = (f: AgentFigures) => {
    const v = csatScore(f.csat);
    return v === null ? "—" : `${Math.round(v * 100)}%`;
  };
  const missed = (f: AgentFigures) => {
    const parts = PRIORITIES.filter((p) => f.missedByPriority[p]).map(
      (p) => `${t(`priorities.${p}`)} ${f.missedByPriority[p]}`,
    );
    return parts.length ? parts.join(" · ") : "—";
  };
  const name = (row: { assigneeId: string | null; name: string | null }) =>
    row.assigneeId === null ? t("unassigned") : (row.name ?? t("former"));

  const cells = (f: AgentFigures) => ({
    received: f.received,
    solved: f.solved,
    openNow: f.openNow,
    firstResponse: duration(f.firstResponseMedianMinutes),
    resolution: duration(f.resolutionMedianMinutes),
    firstOnTime: (
      <span className="tabular-nums">
        {share(f.firstResponseOnTime)}
        <span className="ml-1 text-muted-foreground text-xs">({f.firstResponseOnTime.total})</span>
      </span>
    ),
    resolvedOnTime: (
      <span className="tabular-nums">
        {share(f.resolutionOnTime)}
        <span className="ml-1 text-muted-foreground text-xs">({f.resolutionOnTime.total})</span>
      </span>
    ),
    missed: missed(f),
    csat: (
      <span className="tabular-nums">
        {csat(f)}
        <span className="ml-1 text-muted-foreground text-xs">({f.csat.good + f.csat.bad})</span>
      </span>
    ),
  });

  const COLS = [
    "received",
    "solved",
    "openNow",
    "firstResponse",
    "resolution",
    "firstOnTime",
    "resolvedOnTime",
    "missed",
    "csat",
  ] as const;

  const team = data.team;
  const peak = Math.max(1, ...data.backlog.map((p) => p.open));
  const kpis: { key: string; value: string }[] = [
    { key: "received", value: String(team.received) },
    { key: "solved", value: String(team.solved) },
    { key: "firstResponse", value: duration(team.firstResponseMedianMinutes) },
    { key: "firstOnTime", value: share(team.firstResponseOnTime) },
    { key: "resolvedOnTime", value: share(team.resolutionOnTime) },
    { key: "csat", value: csat(team) },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 font-bold text-2xl tracking-tight">
          <Users className="h-6 w-6 text-primary" aria-hidden />
          {t("title")}
        </h1>
        <p className="mt-1 text-muted-foreground text-sm">{t("subtitle")}</p>
      </div>

      <PeriodNav period={data.period} today={today} href={href} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {kpis.map((k) => (
          <Card key={k.key} className="border-0 shadow-sm">
            <CardContent className="p-4">
              <p className="text-muted-foreground text-xs" title={t(`help.${k.key}`)}>
                {t(`cols.${k.key}`)}
              </p>
              <p className="mt-1 font-semibold text-xl tabular-nums">{k.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {!data.csatEnabled && (
        <p className="rounded-md border border-dashed p-3 text-muted-foreground text-sm">
          {t("csatOff")}{" "}
          <Link
            href="/dashboard/support/sla"
            className="font-medium text-foreground underline-offset-2 hover:underline"
          >
            {t("csatOffLink")}
          </Link>
        </p>
      )}

      <Card className="border-0 shadow-sm">
        <CardContent className="p-0">
          {data.agents.length === 0 ? (
            <p className="px-6 py-8 text-center text-muted-foreground text-sm">{t("empty")}</p>
          ) : (
            <ResponsiveRecordList
              cards={
                <RecordCards
                  className="p-4"
                  items={[...data.agents, { assigneeId: "total", name: null, figures: team }].map((row) => {
                    const c = cells(row.figures);
                    return {
                      id: row.assigneeId ?? "unassigned",
                      title: row.assigneeId === "total" ? t("total") : name(row),
                      badge: <span className="font-semibold text-xs tabular-nums">{row.figures.openNow}</span>,
                      fields: COLS.map((col) => ({ label: t(`cols.${col}`), value: c[col] })),
                    };
                  })}
                />
              }
              table={
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead className="font-semibold text-xs">{t("cols.agent")}</TableHead>
                      {COLS.map((col) => (
                        <TableHead key={col} className="text-right font-semibold text-xs" title={t(`help.${col}`)}>
                          {t(`cols.${col}`)}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.agents.map((row) => {
                      const c = cells(row.figures);
                      return (
                        <TableRow key={row.assigneeId ?? "unassigned"}>
                          <TableCell className="font-medium text-sm">{name(row)}</TableCell>
                          {COLS.map((col) => (
                            <TableCell key={col} className="text-right text-sm tabular-nums">
                              {c[col]}
                            </TableCell>
                          ))}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell className="font-semibold text-sm">{t("total")}</TableCell>
                      {COLS.map((col) => (
                        <TableCell key={col} className="text-right text-sm tabular-nums">
                          {cells(team)[col]}
                        </TableCell>
                      ))}
                    </TableRow>
                  </TableFooter>
                </Table>
              }
            />
          )}
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t("backlogTitle")}</CardTitle>
          <p className="text-muted-foreground text-xs">{t("backlogHelp")}</p>
        </CardHeader>
        <CardContent>
          <ol className="flex h-32 items-end gap-2" aria-label={t("backlogTitle")}>
            {data.backlog.map((p) => (
              <li key={p.at} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
                <span className="text-muted-foreground text-xs tabular-nums">{p.open}</span>
                <span
                  className="w-full rounded-t bg-primary/70"
                  style={{ height: `${Math.max(2, (p.open / peak) * 100)}%` }}
                  aria-hidden
                />
                <span className="truncate text-[10px] text-muted-foreground">
                  {new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(new Date(p.at))}
                </span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      {data.truncated && <p className="text-amber-700 text-xs dark:text-amber-400">{t("truncated")}</p>}
      <p className="text-muted-foreground text-xs">{t("footnote")}</p>
    </div>
  );
}
