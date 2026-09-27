"use client";

import Link from "next/link";

import { ReceiptText } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { StatusBadge, type Tone } from "@/components/crm/record/record-page";
import { RecordCards, ResponsiveRecordList } from "@/components/crm/record-cards";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCurrency } from "@/hooks/use-currency";
import type { ReceivablesSchedule } from "@/lib/receivables";
import { AGING_BUCKETS, type AgingBucket } from "@/lib/receivables-aging";

const TONE: Record<AgingBucket, Tone> = {
  current: "neutral",
  "1-30": "warning",
  "31-60": "danger",
  "61-90": "danger",
  "90+": "danger",
};

/**
 * The receivables schedule (I9, src/lib/receivables.ts): every issued invoice still owed
 * something, the most overdue first, and what is owed by age — per currency, never added
 * across currencies. Each line opens its invoice, where the payment is recorded.
 */
export function ReceivablesCard({ schedule }: { schedule: ReceivablesSchedule }) {
  const t = useTranslations("finance.receivables");
  const format = useFormatter();
  const { formatMoney } = useCurrency();
  const day = (d: string) => format.dateTime(new Date(`${d}T12:00:00Z`), { dateStyle: "medium", timeZone: "UTC" });
  const late = (r: ReceivablesSchedule["invoices"][number]) => (
    <StatusBadge tone={TONE[r.bucket]}>
      {r.daysOverdue > 0 ? t("daysOverdue", { days: r.daysOverdue }) : t("notDue")}
    </StatusBadge>
  );
  const number = (r: ReceivablesSchedule["invoices"][number]) => (
    <Link href={`/dashboard/sales/invoices/${r.id}`} className="font-medium hover:underline">
      {r.documentNumber ?? "—"}
    </Link>
  );

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ReceiptText className="size-4 text-primary" aria-hidden />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("subtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {schedule.invoices.length === 0 ? (
          <p className="py-6 text-center text-muted-foreground text-sm">{t("empty")}</p>
        ) : (
          <>
            {schedule.totals.map((c) => (
              <div key={c.currency} className="space-y-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-semibold tabular-nums">
                    {t("owed", { amount: formatMoney(c.outstanding, c.currency) })}
                  </p>
                  {c.overdue > 0 && (
                    <p className="text-destructive text-sm tabular-nums">
                      {t("overdue", { amount: formatMoney(c.overdue, c.currency) })}
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  {AGING_BUCKETS.map((b) => (
                    <div key={b} className="rounded-md border p-2">
                      <p className="text-muted-foreground text-xs">{t(`bucket.${b}`)}</p>
                      <p className="font-medium text-sm tabular-nums">{formatMoney(c.buckets[b], c.currency)}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <ResponsiveRecordList
              cards={
                <RecordCards
                  items={schedule.invoices.map((r) => ({
                    id: r.id,
                    title: number(r),
                    badge: late(r),
                    fields: [
                      { label: t("cols.customer"), value: r.customer ?? "—" },
                      { label: t("cols.due"), value: day(r.dueDate) },
                      { label: t("cols.outstanding"), value: formatMoney(r.outstanding, r.currency) },
                    ],
                  }))}
                />
              }
              table={
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead className="font-semibold text-xs">{t("cols.invoice")}</TableHead>
                      <TableHead className="font-semibold text-xs">{t("cols.customer")}</TableHead>
                      <TableHead className="font-semibold text-xs">{t("cols.due")}</TableHead>
                      <TableHead className="font-semibold text-xs">{t("cols.status")}</TableHead>
                      <TableHead className="text-right font-semibold text-xs">{t("cols.total")}</TableHead>
                      <TableHead className="text-right font-semibold text-xs">{t("cols.outstanding")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {schedule.invoices.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-sm">{number(r)}</TableCell>
                        <TableCell className="text-sm">{r.customer ?? "—"}</TableCell>
                        <TableCell className="text-sm tabular-nums">{day(r.dueDate)}</TableCell>
                        <TableCell>{late(r)}</TableCell>
                        <TableCell className="text-right text-sm tabular-nums">
                          {formatMoney(r.total - r.credited, r.currency)}
                        </TableCell>
                        <TableCell className="text-right font-medium text-sm tabular-nums">
                          {formatMoney(r.outstanding, r.currency)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              }
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
