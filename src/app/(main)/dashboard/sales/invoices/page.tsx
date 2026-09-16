import Link from "next/link";

import { getTranslations } from "next-intl/server";

import { getInvoiceStartOptions, getInvoices, getStampDutySummary } from "@/actions/invoices";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getActor } from "@/lib/auth-guard";
import { italianToday } from "@/lib/invoice-draft";
import { requirePageCapability } from "@/lib/page-guard";
import { can } from "@/lib/permissions";

import { NewInvoiceDialog } from "./_components/new-invoice-dialog";

export default async function InvoicesPage() {
  await requirePageCapability("record:read", "/dashboard/sales/invoices");
  const year = Number(italianToday().slice(0, 4));
  const [rows, stamps, t, actor] = await Promise.all([
    getInvoices(),
    getStampDutySummary(year),
    getTranslations("invoices"),
    getActor(),
  ]);
  const startOptions = can(actor, "invoice:write") ? await getInvoiceStartOptions() : null;
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
        {startOptions && <NewInvoiceDialog options={startOptions} />}
      </div>
      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="py-12 text-center text-muted-foreground text-sm">{t("empty")}</p>
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
                {rows.map((r) => (
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
