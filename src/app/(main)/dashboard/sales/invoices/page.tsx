import Link from "next/link";

import { Plus } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { getInvoices, getStampDutySummary } from "@/actions/invoices";
import { ListToolbar } from "@/components/crm/list-toolbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getActor } from "@/lib/auth-guard";
import { italianToday } from "@/lib/invoice-draft";
import { requirePageCapability } from "@/lib/page-guard";
import { parseListParams } from "@/lib/pagination";
import { can } from "@/lib/permissions";

const STATUSES = ["all", "draft", "issued"] as const;

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requirePageCapability("record:read", "/dashboard/sales/invoices");
  const params = await searchParams;
  const status = STATUSES.includes(params.status as (typeof STATUSES)[number]) ? params.status : "all";
  const listParams = parseListParams(params);
  const year = Number(italianToday().slice(0, 4));
  const [page, stamps, t, actor] = await Promise.all([
    getInvoices(listParams, status),
    getStampDutySummary(year),
    getTranslations("invoices"),
    getActor(),
  ]);
  const euro = (n: number) => new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(n);
  const money = (value: string, currency: string) =>
    new Intl.NumberFormat("it-IT", { style: "currency", currency }).format(Number(value));

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
                  {s === "all" ? t("allInvoices") : t(`statuses.${s}`)}
                </Link>
              </Button>
            );
          })}
        </div>
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("number")}</TableHead>
                  <TableHead>{t("date")}</TableHead>
                  <TableHead>{t("customer")}</TableHead>
                  <TableHead>{t("type")}</TableHead>
                  <TableHead>{t("status")}</TableHead>
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
                    <TableCell className="tabular-nums">{r.issueDate ?? "—"}</TableCell>
                    <TableCell>{r.companyName ?? "—"}</TableCell>
                    <TableCell>{t(`types.${r.documentType as "TD01" | "TD04"}`)}</TableCell>
                    <TableCell>
                      <Badge variant={r.status === "draft" ? "outline" : "secondary"}>
                        {t(`statuses.${r.status as "draft" | "issued"}`)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{money(r.total, r.currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
