import Link from "next/link";

import { Plus, X } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";

import { getInvoices, getStampDutySummary, type InvoicePaymentState } from "@/actions/invoices";
import { ListToolbar } from "@/components/crm/list-toolbar";
import { StatusBadge, type Tone } from "@/components/crm/record/record-page";
import { RecordCards, ResponsiveRecordList } from "@/components/crm/record-cards";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getActor } from "@/lib/auth-guard";
import { italianToday } from "@/lib/invoice-draft";
import { requirePageCapability } from "@/lib/page-guard";
import { parseListParams } from "@/lib/pagination";
import { can } from "@/lib/permissions";
import { needsAttention } from "@/lib/sdi/status";
import type { SdiStatus } from "@/lib/sdi/types";

// "unpaid" and "overdue" are the receivables schedule's own lists: what Finance chases, findable here.
const STATUSES = ["all", "draft", "issued", "unpaid", "overdue", "sdi"] as const;

const PAYMENT_TONES: Record<InvoicePaymentState["state"], Tone> = {
  overdue: "danger",
  open: "warning",
  paid: "success",
  overpaid: "info",
  credited: "neutral",
};

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requirePageCapability("record:read", "/dashboard/sales/invoices");
  const params = await searchParams;
  const status = STATUSES.includes(params.status as (typeof STATUSES)[number]) ? params.status : "all";
  const listParams = parseListParams(params);
  const issuedMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(params.issued ?? "") ? params.issued : null;
  const year = Number(italianToday().slice(0, 4));
  const [page, stamps, t, actor] = await Promise.all([
    getInvoices(listParams, status, issuedMonth),
    getStampDutySummary(year),
    getTranslations("invoices"),
    getActor(),
  ]);
  const numberLocale = (await getLocale()) === "it" ? "it-IT" : "en-GB";
  const euro = (n: number) => new Intl.NumberFormat(numberLocale, { style: "currency", currency: "EUR" }).format(n);
  const money = (value: string | number, currency: string) =>
    new Intl.NumberFormat(numberLocale, { style: "currency", currency }).format(Number(value));
  // ⚠️ A credit note takes money back: shown with its sign, so a column read top to bottom adds up.
  const signed = (r: { total: string; currency: string; documentType: string }) =>
    money(r.documentType === "TD04" ? -Math.abs(Number(r.total)) : Number(r.total), r.currency);
  // Dates as the reader writes them, not as the database stores them.
  const day = (value: string | null) =>
    value
      ? new Intl.DateTimeFormat(numberLocale, { dateStyle: "medium", timeZone: "UTC" }).format(
          new Date(`${value}T00:00:00Z`),
        )
      : "—";
  const paymentLabel = (p: InvoicePaymentState, currency: string) =>
    p.state === "overdue"
      ? t("paymentState.overdue", { amount: money(p.overdueAmount, currency), days: p.daysOverdue })
      : p.state === "open"
        ? t("paymentState.open", { amount: money(p.outstanding, currency), date: day(p.dueDate) })
        : t(`paymentState.${p.state}`);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-bold text-2xl tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
        </div>
        {can(actor, "invoice:write") && (
          <Button asChild className="shrink-0 gap-2">
            <Link href="/dashboard/sales/invoices/new">
              <Plus className="h-4 w-4" />
              {t("newInvoice")}
            </Link>
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {STATUSES.map((s) => {
            const next = new URLSearchParams(params);
            if (s === "all") next.delete("status");
            else next.set("status", s);
            next.delete("page");
            const q = next.toString();
            return (
              <Button key={s} asChild size="sm" variant={status === s ? "default" : "outline"}>
                <Link href={q ? `?${q}` : "?"} scroll={false}>
                  {s === "all" ? t("allInvoices") : t(`filters.${s}`)}
                </Link>
              </Button>
            );
          })}
        </div>
        {issuedMonth && (
          // Opened from the home's "invoiced this month": the period is a chip that can be removed.
          <Button asChild size="sm" variant="secondary" className="gap-1.5">
            <Link
              href={(() => {
                const next = new URLSearchParams(params);
                next.delete("issued");
                next.delete("page");
                const q = next.toString();
                return q ? `?${q}` : "?";
              })()}
              scroll={false}
            >
              {t("issuedInMonth", {
                month: new Intl.DateTimeFormat(numberLocale, {
                  month: "long",
                  year: "numeric",
                  timeZone: "UTC",
                }).format(new Date(`${issuedMonth}-01T00:00:00Z`)),
              })}
              <X className="size-3.5" aria-hidden />
            </Link>
          </Button>
        )}
        <ListToolbar
          total={page.total}
          page={page.page}
          pageCount={page.pageCount}
          pageSize={page.pageSize}
          shown={page.rows.length}
          searchPlaceholder={t("searchPlaceholder")}
        />
      </div>
      <Card>
        <CardContent className="p-0">
          {page.rows.length === 0 ? (
            <p className="py-12 text-center text-muted-foreground text-sm">
              {page.total === 0 && !listParams.search && status === "all" ? t("empty") : t("noMatches")}
            </p>
          ) : (
            <ResponsiveRecordList
              cards={
                // Six columns on a phone is a sideways scroll with the number on
                // one edge and the total on the other. The same rows, as cards.
                <RecordCards
                  className="p-2"
                  items={page.rows.map((r) => ({
                    id: r.id,
                    href: `/dashboard/sales/invoices/${r.id}`,
                    title: <span className="font-mono">{r.documentNumber ?? t("draftNumber")}</span>,
                    subtitle: r.companyName ?? undefined,
                    badge: <span className="font-semibold text-sm tabular-nums">{signed(r)}</span>,
                    meta: (
                      <>
                        <Badge variant={r.status === "draft" ? "outline" : "secondary"}>
                          {t(`statuses.${r.status as "draft" | "issued"}`)}
                        </Badge>
                        {needsAttention(r.sdiStatus as SdiStatus | null) && (
                          <StatusBadge tone="danger">{t(`sdiBadge.${r.sdiStatus as "rejected"}`)}</StatusBadge>
                        )}
                        {Number(r.creditedAmount) > 0 && (
                          <Badge variant="outline">
                            {Number(r.creditedAmount) >= Number(r.total)
                              ? t("credit.fullyCredited")
                              : t("credit.partlyCredited")}
                          </Badge>
                        )}
                        <span className="text-muted-foreground text-xs">
                          {t(`types.${r.documentType as "TD01" | "TD02" | "TD04"}`)}
                        </span>
                        {r.issueDate && (
                          <span className="text-muted-foreground text-xs tabular-nums">{day(r.issueDate)}</span>
                        )}
                        {r.payment && r.payment.state !== "credited" && (
                          <StatusBadge tone={PAYMENT_TONES[r.payment.state]}>
                            {paymentLabel(r.payment, r.currency)}
                          </StatusBadge>
                        )}
                      </>
                    ),
                  }))}
                />
              }
              table={
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("number")}</TableHead>
                      <TableHead>{t("date")}</TableHead>
                      <TableHead>{t("customer")}</TableHead>
                      <TableHead>{t("type")}</TableHead>
                      <TableHead>{t("status")}</TableHead>
                      <TableHead>{t("paymentColumn")}</TableHead>
                      <TableHead className="text-right">{t("total")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {page.rows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono">
                          <Link href={`/dashboard/sales/invoices/${r.id}`} className="hover:underline">
                            {r.documentNumber ?? t("draftNumber")}
                          </Link>
                        </TableCell>
                        <TableCell className="whitespace-nowrap tabular-nums">{day(r.issueDate)}</TableCell>
                        <TableCell>{r.companyName ?? "—"}</TableCell>
                        <TableCell>{t(`types.${r.documentType as "TD01" | "TD02" | "TD04"}`)}</TableCell>
                        <TableCell>
                          <Badge variant={r.status === "draft" ? "outline" : "secondary"}>
                            {t(`statuses.${r.status as "draft" | "issued"}`)}
                          </Badge>
                          {needsAttention(r.sdiStatus as SdiStatus | null) && (
                            <StatusBadge tone="danger">{t(`sdiBadge.${r.sdiStatus as "rejected"}`)}</StatusBadge>
                          )}
                          {Number(r.creditedAmount) > 0 && (
                            <Badge variant="outline" className="ml-1">
                              {Number(r.creditedAmount) >= Number(r.total)
                                ? t("credit.fullyCredited")
                                : t("credit.partlyCredited")}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {r.payment && r.payment.state !== "credited" ? (
                            <StatusBadge tone={PAYMENT_TONES[r.payment.state]}>
                              {paymentLabel(r.payment, r.currency)}
                            </StatusBadge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell
                          className={
                            r.documentType === "TD04"
                              ? "text-right text-destructive tabular-nums"
                              : "text-right tabular-nums"
                          }
                        >
                          {signed(r)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              }
            />
          )}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-3 p-4">
          <div>
            <p className="font-semibold text-sm">{t("stampSummaryTitle", { year })}</p>
            <p className="text-muted-foreground text-xs">{t("stampSummaryHint")}</p>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("quarter")}</TableHead>
                  <TableHead className="text-right">{t("invoicesWithStamp")}</TableHead>
                  <TableHead className="text-right">{t("amount")}</TableHead>
                  <TableHead>{t("f24Code")}</TableHead>
                  <TableHead>{t("payBy")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stamps.map((q) => (
                  <TableRow key={q.quarter}>
                    <TableCell>{t("quarterN", { n: q.quarter })}</TableCell>
                    <TableCell className="text-right tabular-nums">{q.invoices}</TableCell>
                    <TableCell className="text-right tabular-nums">{euro(q.amount)}</TableCell>
                    <TableCell className="font-mono">{q.f24Code}</TableCell>
                    <TableCell className="tabular-nums">
                      {q.dueDate}
                      {q.deferred && <span className="ml-2 text-muted-foreground text-xs">({t("deferred")})</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
