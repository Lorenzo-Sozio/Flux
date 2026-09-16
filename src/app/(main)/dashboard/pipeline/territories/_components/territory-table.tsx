"use client";

import Link from "next/link";

import { useTranslations } from "next-intl";

import type { TerritoryReport } from "@/actions/territory-report";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCurrency } from "@/hooks/use-currency";
import { cn } from "@/lib/utils";

/** On the client because money is shown in the workspace currency, which lives in a client context. */
export function TerritoryTable({ report, canManage }: { report: TerritoryReport; canManage: boolean }) {
  const t = useTranslations("pipeline.territories");
  const { formatAmount } = useCurrency();

  return (
    <div className="space-y-4">
      {report.territoryCount === 0 && (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="min-w-0 text-muted-foreground text-sm">{t("noTerritories")}</p>
            {canManage && (
              <Button asChild size="sm" variant="outline">
                <Link href="/dashboard/settings/territories">{t("defineTerritories")}</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("territory")}</TableHead>
                <TableHead className="text-right">{t("openLeads")}</TableHead>
                <TableHead className="text-right">{t("newLeads")}</TableHead>
                <TableHead className="text-right">{t("converted")}</TableHead>
                <TableHead className="text-right">{t("openDeals")}</TableHead>
                <TableHead className="text-right">{t("pipeline")}</TableHead>
                <TableHead className="text-right">{t("won")}</TableHead>
                <TableHead className="text-right">{t("winRate")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.rows.map((row) => {
                const f = row.figures;
                const none = row.territoryId === null;
                return (
                  <TableRow key={row.territoryId ?? "none"} className={cn(none && "bg-muted/40")}>
                    <TableCell className={cn("font-medium", none && "text-muted-foreground italic")}>
                      {row.name ?? t("noTerritory")}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{f.openLeads}</TableCell>
                    <TableCell className="text-right tabular-nums">{f.newLeads}</TableCell>
                    <TableCell className="text-right tabular-nums">{f.convertedLeads}</TableCell>
                    <TableCell className="text-right tabular-nums">{f.openDeals}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatAmount(f.openValue)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatAmount(f.wonValue)}
                      <span className="ml-1 text-muted-foreground text-xs">({f.wonDeals})</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.winRate === null ? "—" : `${row.winRate}%`}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="text-muted-foreground text-xs">{t("footnote", { days: report.days })}</p>
    </div>
  );
}
