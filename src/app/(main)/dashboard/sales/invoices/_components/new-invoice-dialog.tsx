"use client";

import { useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { AlertTriangle, Loader2, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { createBlankInvoice, createInvoiceFromOrder, type getInvoiceStartOptions } from "@/actions/invoices";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Options = Awaited<ReturnType<typeof getInvoiceStartOptions>>;

/**
 * The way into invoicing from the invoice list.
 *
 * An invoice used to be creatable only from the button on an order's page, so the
 * page named "Invoices" had no way to make one and said so in a sentence nobody
 * reads. Both starts live here: from an order, which copies its lines, or blank.
 */
export function NewInvoiceDialog({ options }: { options: Options }) {
  const t = useTranslations("invoices");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState(options.orders.length > 0 ? "order" : "blank");
  const [orderId, setOrderId] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [busy, setBusy] = useState(false);

  const money = (value: string, currency: string) =>
    new Intl.NumberFormat("it-IT", { style: "currency", currency }).format(Number(value));

  const create = async () => {
    setBusy(true);
    try {
      const result = tab === "order" ? await createInvoiceFromOrder(orderId) : await createBlankInvoice(companyId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setOpen(false);
      router.push(`/dashboard/sales/invoices/${result.id}`);
    } finally {
      setBusy(false);
    }
  };

  const ready = tab === "order" ? Boolean(orderId) : Boolean(companyId);

  return (
    <>
      <Button onClick={() => setOpen(true)} className="shrink-0 gap-2">
        <Plus className="h-4 w-4" />
        {t("newInvoice")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="gap-0 p-0 sm:max-w-lg">
          <DialogHeader className="border-b px-5 pt-5 pb-4">
            <DialogTitle>{t("newTitle")}</DialogTitle>
            <DialogDescription>{t("newSubtitle")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 px-5 py-4">
            {!options.issuerReady && (
              <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 text-xs dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0 space-y-1">
                  <p>{t("issuerMissing")}</p>
                  <Link href="/dashboard/settings/invoicing" className="font-medium underline">
                    {t("issuerSettings")}
                  </Link>
                </div>
              </div>
            )}
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="order">{t("fromOrder")}</TabsTrigger>
                <TabsTrigger value="blank">{t("blank")}</TabsTrigger>
              </TabsList>
              <TabsContent value="order" className="space-y-2 pt-3">
                <SearchableSelect
                  options={options.orders.map((o) => ({
                    value: o.id,
                    label: `${o.orderNumber} — ${o.companyName ?? "—"}`,
                    sublabel: `${o.createdAt} · ${money(o.total, o.currency)}`,
                  }))}
                  value={orderId}
                  onChange={setOrderId}
                  placeholder={t("chooseOrder")}
                  searchPlaceholder={t("searchOrder")}
                  emptyText={t("noOrders")}
                />
                <p className="text-muted-foreground text-xs">
                  {options.orders.length === 0 ? t("noOrders") : t("fromOrderHint")}
                </p>
              </TabsContent>
              <TabsContent value="blank" className="space-y-2 pt-3">
                <SearchableSelect
                  options={options.companies.map((c) => ({ value: c.id, label: c.name }))}
                  value={companyId}
                  onChange={setCompanyId}
                  placeholder={t("chooseCompany")}
                  searchPlaceholder={t("searchCompany")}
                  emptyText={t("noCompanies")}
                />
                <p className="text-muted-foreground text-xs">{t("blankHint")}</p>
              </TabsContent>
            </Tabs>
          </div>
          <div className="flex justify-end gap-2 border-t px-5 py-3">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button onClick={create} disabled={!ready || busy} className="gap-2">
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t("createDraft")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
