import Link from "next/link";

import { getTranslations } from "next-intl/server";

import { getInvoices } from "@/actions/invoices";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePageCapability } from "@/lib/page-guard";

export default async function InvoicesPage() {
  await requirePageCapability("record:read", "/dashboard/sales/invoices");
  const [rows, t] = await Promise.all([getInvoices(), getTranslations("invoices")]);
  const money = (value: string, currency: string) =>
    new Intl.NumberFormat("it-IT", { style: "currency", currency }).format(Number(value));

  return (
    <div className="space-y-6">
      <div className="min-w-0">
        <h1 className="font-bold text-2xl tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
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
    </div>
  );
}
