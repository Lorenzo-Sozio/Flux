"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { Building2, Loader2, X } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";

import { confirmBankLineAction, getCompanyOpenItems } from "@/actions/bank";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCurrency } from "@/hooks/use-currency";
import { parsePaymentAmount } from "@/lib/order-payment";

import type { OpenLine } from "./bank-view";

type Hit = { id: string; label: string; sub: string | null };
type OpenItems = Awaited<ReturnType<typeof getCompanyOpenItems>>;

const cents = (n: number) => Math.round(n * 100);

/**
 * Where a line goes, chosen by hand: a customer, the invoices it pays and how much of each.
 * What is not given to an invoice stays as the customer's credit — never paid beyond what an
 * invoice owes, which the server refuses anyway.
 */
export function BankChooseDialog({
  open,
  onOpenChange,
  line,
  initialCompany,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  line: OpenLine;
  initialCompany: { id: string; name: string } | null;
  onDone: () => void;
}) {
  const t = useTranslations("bank");
  const format = useFormatter();
  const { formatMoney } = useCurrency();
  const [company, setCompany] = useState(initialCompany);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [searching, setSearching] = useState(false);
  const [items, setItems] = useState<OpenItems | null>(null);
  const [shares, setShares] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const request = useRef(0);

  const left = Math.round((line.amount - line.linked) * 100) / 100;

  useEffect(() => {
    const q = query.trim();
    if (company || q.length < 2) {
      setHits([]);
      return;
    }
    const n = ++request.current;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&types=company`);
        const data = (await res.json()) as { groups?: { hits: Hit[] }[] };
        if (n === request.current) setHits((data.groups ?? []).flatMap((g) => g.hits).slice(0, 8));
      } finally {
        if (n === request.current) setSearching(false);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [query, company]);

  useEffect(() => {
    setItems(null);
    setShares({});
    if (!company) return;
    let live = true;
    getCompanyOpenItems(company.id)
      .then((r) => live && setItems(r))
      .catch(() => live && toast.error(t("failed")));
    return () => {
      live = false;
    };
  }, [company, t]);

  const invoices = (items?.invoices ?? []).filter((i) => i.currency === line.currency);
  const allocated = Object.values(shares).reduce((s, v) => s + cents(parsePaymentAmount(v) ?? 0), 0);
  const toCredit = (cents(left) - allocated) / 100;
  const over = toCredit < 0;

  function toggle(id: string, outstanding: number, on: boolean) {
    setShares((s) => {
      const next = { ...s };
      if (!on) delete next[id];
      else {
        const room =
          cents(left) -
          Object.entries(s).reduce((sum, [k, v]) => sum + (k === id ? 0 : cents(parsePaymentAmount(v) ?? 0)), 0);
        next[id] = (Math.max(0, Math.min(cents(outstanding), room)) / 100).toFixed(2);
      }
      return next;
    });
  }

  function submit() {
    if (!company || over) return;
    start(async () => {
      const r = await confirmBankLineAction(line.id, {
        companyId: company.id,
        allocations: Object.entries(shares).map(([invoiceId, amount]) => ({ invoiceId, amount })),
      }).catch(() => null);
      if (!r?.ok) {
        toast.error(r && !r.ok ? r.error : t("failed"));
        return;
      }
      toast.success(t("confirmed"));
      onDone();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("chooseTitle")}</DialogTitle>
          <DialogDescription>{t("chooseHint")}</DialogDescription>
        </DialogHeader>
        <p className="text-sm">{t("lineAmount", { amount: formatMoney(left, line.currency) })}</p>

        <div className="space-y-1.5">
          <Label htmlFor="bank-company">{t("customer")}</Label>
          {company ? (
            <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <Building2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate">{company.name}</span>
              </span>
              <Button
                size="icon"
                variant="ghost"
                className="size-7"
                aria-label={t("cancel")}
                onClick={() => setCompany(null)}
              >
                <X className="size-3.5" aria-hidden />
              </Button>
            </div>
          ) : (
            <>
              <Input
                id="bank-company"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("searchCustomer")}
              />
              {searching && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />}
              {hits.length > 0 && (
                <ul className="max-h-48 overflow-y-auto rounded-md border">
                  {hits.map((h) => (
                    <li key={h.id}>
                      <button
                        type="button"
                        className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
                        onClick={() => {
                          setCompany({ id: h.id, name: h.label });
                          setQuery("");
                        }}
                      >
                        {h.label}
                        {h.sub && <span className="ml-2 text-muted-foreground text-xs">{h.sub}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {!searching && query.trim().length >= 2 && hits.length === 0 && (
                <p className="text-muted-foreground text-xs">{t("noResults")}</p>
              )}
            </>
          )}
        </div>

        {company && (
          <div className="space-y-2">
            <p className="font-medium text-sm">{t("openInvoices")}</p>
            {!items ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
            ) : invoices.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("noOpenInvoices")}</p>
            ) : (
              <ul className="max-h-64 space-y-1 overflow-y-auto">
                {invoices.map((i) => {
                  const on = i.id in shares;
                  return (
                    <li key={i.id} className="flex items-center gap-2 rounded-md border px-2 py-1.5">
                      <Checkbox
                        id={`inv-${i.id}`}
                        checked={on}
                        onCheckedChange={(v) => toggle(i.id, i.outstanding, v === true)}
                      />
                      <label htmlFor={`inv-${i.id}`} className="min-w-0 flex-1 text-sm">
                        <span className="font-medium">{t("proposal.invoice", { number: i.number ?? "—" })}</span>
                        <span className="block text-muted-foreground text-xs">
                          {t("owes", { amount: formatMoney(i.outstanding, i.currency) })} ·{" "}
                          {t("dueOn", {
                            date: format.dateTime(new Date(`${i.dueDate}T12:00:00Z`), {
                              day: "2-digit",
                              month: "short",
                              timeZone: "UTC",
                            }),
                          })}
                        </span>
                      </label>
                      {on && (
                        <Input
                          aria-label={t("proposal.invoice", { number: i.number ?? "—" })}
                          className="h-8 w-28 text-right tabular-nums"
                          inputMode="decimal"
                          value={shares[i.id]}
                          onChange={(e) => setShares((s) => ({ ...s, [i.id]: e.target.value }))}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <p className={over ? "text-destructive text-sm" : "text-muted-foreground text-sm"}>
              {over ? t("overAllocated") : t("toCredit", { amount: formatMoney(toCredit, line.currency) })}
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            {t("cancel")}
          </Button>
          <Button onClick={submit} disabled={!company || over || pending} className="gap-1.5">
            {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            {t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
