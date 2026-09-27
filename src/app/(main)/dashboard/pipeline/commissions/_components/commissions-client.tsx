"use client";

import { type ReactNode, useState, useTransition } from "react";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { HandCoins, Lock, LockOpen, Plus, Trash2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";

import {
  approveCommissionMonthAction,
  deleteCommissionRuleAction,
  reopenCommissionMonthAction,
  saveCommissionRuleAction,
} from "@/actions/commissions";
import { PeriodNav } from "@/components/crm/period-nav";
import { StatusBadge } from "@/components/crm/record/record-page";
import { RecordCards, ResponsiveRecordList } from "@/components/crm/record-cards";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCurrency } from "@/hooks/use-currency";
import { usePeriodLabel } from "@/hooks/use-period-label";
import type { CommissionLine, CommissionReport, CommissionRow, CommissionRule } from "@/lib/commissions";
import { UNASSIGNED } from "@/lib/pipeline-filters";

// Radix Select refuses an empty value, so "everyone" and "every pipeline" need a name.
const ALL = "__all";

/**
 * Commissions: what each person's wins earned, which months are approved, and the rates.
 *
 * ⚠️ Amounts are EUR, as deals are at rest, and shown as EUR — not converted to the viewer's
 * display currency: this is what somebody is paid, not a figure to compare.
 */
export function CommissionsClient({
  report,
  rules,
  canManage,
  timeZone,
  members,
  pipelines,
  approvable,
  today,
  todayDate,
}: {
  report: CommissionReport;
  rules: CommissionRule[];
  canManage: boolean;
  timeZone: string;
  members: { id: string; name: string; former: boolean }[];
  pipelines: { id: string; name: string }[];
  /** Months of this period over and not approved. */
  approvable: string[];
  today: string;
  /** Today on the workspace's clock, YYYY-MM-DD: where a new rule starts. */
  todayDate: string;
}) {
  const t = useTranslations("commissions");
  const format = useFormatter();
  const periodLabel = usePeriodLabel();
  const { formatMoney } = useCurrency();
  const router = useRouter();
  const search = useSearchParams();
  const [pending, startTransition] = useTransition();

  const eur = (n: number) => formatMoney(n, "EUR");
  const day = (d: Date) => format.dateTime(new Date(d), { dateStyle: "medium", timeZone });
  const nameOf = (id: string | null) =>
    !id || id === UNASSIGNED
      ? t("unassigned")
      : (() => {
          const m = members.find((x) => x.id === id);
          return m ? (m.former ? t("former", { name: m.name }) : m.name) : t("someone");
        })();
  const pipelineOf = (id: string | null) =>
    id ? (pipelines.find((p) => p.id === id)?.name ?? t("pipelineGone")) : t("allPipelines");

  const href = (period: string) => {
    const q = new URLSearchParams(search.toString());
    q.set("period", period);
    return `/dashboard/pipeline/commissions?${q.toString()}`;
  };

  const run = (fn: () => Promise<void>) => startTransition(async () => fn().then(() => router.refresh()));

  const approve = (month: string) =>
    run(async () => {
      const r = await approveCommissionMonthAction(month);
      if (r.ok) toast.success(t("approvedToast", { month: periodLabel(month), lines: r.lines, total: eur(r.total) }));
      else toast.error(t(`errors.${r.reason}`));
    });
  const reopen = (month: string) =>
    run(async () => {
      await reopenCommissionMonthAction(month);
      toast.success(t("reopenedToast", { month: periodLabel(month) }));
    });

  const pct = (n: number | null) => (n === null ? "—" : `${format.number(n, { maximumFractionDigits: 2 })}%`);
  const status = (l: CommissionLine) => {
    if (l.drift) return <StatusBadge tone="warning">{t(`drift.${l.drift}`)}</StatusBadge>;
    if (l.approved) return <StatusBadge tone="success">{t("state.approved")}</StatusBadge>;
    if (l.late) return <StatusBadge tone="info">{t("state.late")}</StatusBadge>;
    if (l.ratePercent === null) return <StatusBadge>{t(l.userId ? "state.noRule" : "state.noOwner")}</StatusBadge>;
    return <StatusBadge>{t("state.accruing")}</StatusBadge>;
  };
  const dealName = (l: CommissionLine) =>
    l.dealId ? (
      <Link href={`/dashboard/pipeline/${l.dealId}`} className="font-medium hover:underline">
        {l.dealName}
      </Link>
    ) : (
      <span className="font-medium">{l.dealName}</span>
    );

  const rowCells = (r: Omit<CommissionRow, "userId">) => ({
    deals: r.deals,
    base: eur(r.base),
    amount: <span className="font-semibold">{eur(r.amount)}</span>,
    approved: eur(r.approved),
    unpaid: r.unpaid,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 font-bold text-2xl tracking-tight">
          <HandCoins className="h-6 w-6 text-primary" aria-hidden />
          {t("title")}
        </h1>
        <p className="mt-1 text-muted-foreground text-sm">{canManage ? t("subtitleManager") : t("subtitleOwn")}</p>
      </div>

      <PeriodNav period={report.period} today={today} href={href} />

      {/* Where each month stands: approved, waiting, or still running. */}
      <div className="flex flex-wrap gap-2">
        {report.months.map((m) => (
          <div key={m.month} className="flex min-w-0 items-center gap-2 rounded-lg border px-3 py-2 text-sm">
            <span className="font-medium">{periodLabel(m.month)}</span>
            {m.approvedAt ? (
              <>
                <StatusBadge tone="success">
                  <Lock aria-hidden />
                  {t("monthApproved", { date: day(m.approvedAt), by: nameOf(m.approvedBy) })}
                </StatusBadge>
                {canManage && (
                  <Confirm
                    title={t("reopenTitle", { month: periodLabel(m.month) })}
                    body={t("reopenBody")}
                    action={t("reopen")}
                    onConfirm={() => reopen(m.month)}
                    trigger={
                      <Button size="sm" variant="ghost" disabled={pending}>
                        <LockOpen className="size-4" aria-hidden />
                        {t("reopen")}
                      </Button>
                    }
                  />
                )}
              </>
            ) : approvable.includes(m.month) ? (
              canManage ? (
                <Confirm
                  title={t("approveTitle", { month: periodLabel(m.month) })}
                  body={t("approveBody")}
                  action={t("approve")}
                  onConfirm={() => approve(m.month)}
                  trigger={
                    <Button size="sm" disabled={pending}>
                      <Lock className="size-4" aria-hidden />
                      {t("approve")}
                    </Button>
                  }
                />
              ) : (
                <StatusBadge tone="warning">{t("monthWaiting")}</StatusBadge>
              )
            ) : (
              <StatusBadge>{t("monthRunning")}</StatusBadge>
            )}
          </div>
        ))}
      </div>

      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">{t("byPerson")}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {report.rows.length === 0 ? (
            <p className="px-6 py-8 text-center text-muted-foreground text-sm">{t("empty")}</p>
          ) : (
            <ResponsiveRecordList
              cards={
                <RecordCards
                  className="p-4"
                  items={report.rows.map((r) => {
                    const c = rowCells(r);
                    return {
                      id: r.userId,
                      title: nameOf(r.userId),
                      badge: c.amount,
                      fields: [
                        { label: t("cols.deals"), value: c.deals },
                        { label: t("cols.base"), value: c.base },
                        { label: t("cols.approved"), value: c.approved },
                        { label: t("cols.unpaid"), value: c.unpaid },
                      ],
                    };
                  })}
                />
              }
              table={
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead className="font-semibold text-xs">{t("cols.person")}</TableHead>
                      <TableHead className="text-right font-semibold text-xs">{t("cols.deals")}</TableHead>
                      <TableHead className="text-right font-semibold text-xs">{t("cols.base")}</TableHead>
                      <TableHead className="text-right font-semibold text-xs">{t("cols.amount")}</TableHead>
                      <TableHead className="text-right font-semibold text-xs">{t("cols.approved")}</TableHead>
                      <TableHead className="text-right font-semibold text-xs" title={t("unpaidHelp")}>
                        {t("cols.unpaid")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.rows.map((r) => {
                      const c = rowCells(r);
                      return (
                        <TableRow key={r.userId}>
                          <TableCell className="font-medium text-sm">{nameOf(r.userId)}</TableCell>
                          <TableCell className="text-right text-sm tabular-nums">{c.deals}</TableCell>
                          <TableCell className="text-right text-sm tabular-nums">{c.base}</TableCell>
                          <TableCell className="text-right text-sm tabular-nums">{c.amount}</TableCell>
                          <TableCell className="text-right text-sm tabular-nums">{c.approved}</TableCell>
                          <TableCell className="text-right text-sm tabular-nums">{c.unpaid}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                  {report.rows.length > 1 && (
                    <TableFooter>
                      {(() => {
                        const c = rowCells(report.totals);
                        return (
                          <TableRow>
                            <TableCell className="font-semibold text-sm">{t("total")}</TableCell>
                            <TableCell className="text-right text-sm tabular-nums">{c.deals}</TableCell>
                            <TableCell className="text-right text-sm tabular-nums">{c.base}</TableCell>
                            <TableCell className="text-right text-sm tabular-nums">{c.amount}</TableCell>
                            <TableCell className="text-right text-sm tabular-nums">{c.approved}</TableCell>
                            <TableCell className="text-right text-sm tabular-nums">{c.unpaid}</TableCell>
                          </TableRow>
                        );
                      })()}
                    </TableFooter>
                  )}
                </Table>
              }
            />
          )}
        </CardContent>
      </Card>

      {report.lines.length > 0 && (
        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">{t("lines")}</CardTitle>
            <CardDescription>{t("linesHelp")}</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <ResponsiveRecordList
              cards={
                <RecordCards
                  className="p-4"
                  items={report.lines.map((l, i) => ({
                    id: l.dealId ?? `gone-${i}`,
                    title: dealName(l),
                    badge: status(l),
                    fields: [
                      { label: t("cols.person"), value: nameOf(l.userId) },
                      { label: t("cols.won"), value: day(l.wonAt) },
                      { label: t("cols.base"), value: eur(l.base) },
                      { label: t("cols.rate"), value: pct(l.ratePercent) },
                      { label: t("cols.amount"), value: eur(l.amount) },
                    ],
                  }))}
                />
              }
              table={
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead className="font-semibold text-xs">{t("cols.deal")}</TableHead>
                      <TableHead className="font-semibold text-xs">{t("cols.person")}</TableHead>
                      <TableHead className="font-semibold text-xs">{t("cols.won")}</TableHead>
                      <TableHead className="text-right font-semibold text-xs">{t("cols.base")}</TableHead>
                      <TableHead className="text-right font-semibold text-xs">{t("cols.rate")}</TableHead>
                      <TableHead className="text-right font-semibold text-xs">{t("cols.amount")}</TableHead>
                      <TableHead className="font-semibold text-xs">{t("cols.state")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.lines.map((l, i) => (
                      <TableRow key={l.dealId ?? `gone-${i}`}>
                        <TableCell className="text-sm">{dealName(l)}</TableCell>
                        <TableCell className="text-sm">{nameOf(l.userId)}</TableCell>
                        <TableCell className="text-sm tabular-nums">{day(l.wonAt)}</TableCell>
                        <TableCell className="text-right text-sm tabular-nums">{eur(l.base)}</TableCell>
                        <TableCell className="text-right text-sm tabular-nums">{pct(l.ratePercent)}</TableCell>
                        <TableCell className="text-right font-medium text-sm tabular-nums">{eur(l.amount)}</TableCell>
                        <TableCell>{status(l)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              }
            />
          </CardContent>
        </Card>
      )}

      {canManage && (
        <RulesCard
          rules={rules}
          members={members}
          pipelines={pipelines}
          nameOf={nameOf}
          pipelineOf={pipelineOf}
          todayDate={todayDate}
        />
      )}

      <p className="text-muted-foreground text-xs">{t("footnote")}</p>
    </div>
  );
}

function Confirm({
  title,
  body,
  action,
  onConfirm,
  trigger,
}: {
  title: string;
  body: string;
  action: string;
  onConfirm: () => void;
  trigger: ReactNode;
}) {
  const t = useTranslations("commissions");
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{action}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** The rates: who, which pipeline, how much, from when. A change is a new rule from a later day. */
function RulesCard({
  rules,
  members,
  pipelines,
  nameOf,
  pipelineOf,
  todayDate,
}: {
  rules: CommissionRule[];
  members: { id: string; name: string; former: boolean }[];
  pipelines: { id: string; name: string }[];
  nameOf: (id: string | null) => string;
  pipelineOf: (id: string | null) => string;
  todayDate: string;
}) {
  const t = useTranslations("commissions");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [userId, setUserId] = useState(ALL);
  const [pipelineId, setPipelineId] = useState(ALL);
  const [rate, setRate] = useState("");
  const [validFrom, setValidFrom] = useState(todayDate);

  const save = () =>
    startTransition(async () => {
      const r = await saveCommissionRuleAction({
        userId: userId === ALL ? null : userId,
        pipelineId: pipelineId === ALL ? null : pipelineId,
        ratePercent: rate,
        validFrom,
      });
      if (!r.ok) {
        toast.error(t("errors.invalidRule"));
        return;
      }
      setRate("");
      toast.success(t("ruleSaved"));
      router.refresh();
    });
  const remove = (id: string) =>
    startTransition(async () => {
      await deleteCommissionRuleAction(id);
      router.refresh();
    });

  // Newest first: the rate in force is the one people look for.
  const shown = [...rules].sort((a, b) => b.validFrom.localeCompare(a.validFrom));

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base">{t("rules")}</CardTitle>
        <CardDescription>{t("rulesHelp")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {shown.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("noRules")}</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {shown.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {r.userId ? nameOf(r.userId) : t("everyone")} · {pipelineOf(r.pipelineId)}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {t("ruleLine", { rate: String(r.ratePercent), from: r.validFrom })}
                  </p>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => remove(r.id)}
                  aria-label={t("deleteRule")}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
          <div className="space-y-1.5">
            <Label>{t("fields.person")}</Label>
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("everyone")}</SelectItem>
                {members
                  .filter((m) => !m.former)
                  .map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{t("fields.pipeline")}</Label>
            <Select value={pipelineId} onValueChange={setPipelineId}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("allPipelines")}</SelectItem>
                {pipelines.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="commission-rate">{t("fields.rate")}</Label>
            <Input
              id="commission-rate"
              inputMode="decimal"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              placeholder="5"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="commission-from">{t("fields.from")}</Label>
            <Input id="commission-from" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
          </div>
          <Button onClick={save} disabled={pending || rate.trim() === ""}>
            <Plus className="size-4" aria-hidden />
            {t("addRule")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
