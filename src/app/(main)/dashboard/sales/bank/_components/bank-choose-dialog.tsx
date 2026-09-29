"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { Building2, Link2, Loader2, X } from "lucide-react";
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
import { cn } from "@/lib/utils";

import type { OpenLine } from "./bank-view";

type Hit = { id: string; label: string; sub: string | null };
type OpenItems = Awaited<ReturnType<typeof getCompanyOpenItems>>;

const cents = (n: number) => Math.round(n * 100);

/**
 * An amount as a person types it here: "1.234,56", "1234,56" or "1234.56". Null when it is not
 * one — which marks the field and holds the confirmation, rather than counting it as nothing and
 * writing the whole line as credit.
 */
export function readAmount(raw: string): number | null {
  const v = raw.trim().replace(/\s|€/g, "");
  if (!v) return 0;
  const normalized = v.includes(",") ? v.replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".") : v;
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  return Number(normalized);
}

/**
 * Where a line goes, chosen by hand: money already typed by hand for it, or a customer, the
 * invoices it pays and the orders it is a deposit on. What goes to none of them stays as the
 * customer's credit — never paid beyond what an invoice owes, which the server refuses anyway.
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
  // Shares typed per document: `i:<invoice>` or `o:<order>`.
  const [shares, setShares] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const request = useRef(0);

  const left = Math.round((line.amount - line.linked) * 100) / 100;
  const day = (d: string) =>
    format.dateTime(new Date(`${d}T12:00:00Z`), { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

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
  const orderRows = (items?.orders ?? []).filter((o) => o.currency === line.currency);
  const loose = (items?.receipts ?? []).filter((r) => r.currency === line.currency && cents(r.amount) <= cents(left));
  const credit = (items?.credit ?? []).find((c) => c.currency === line.currency)?.credit ?? 0;

  const parsed = Object.entries(shares).map(([key, raw]) => ({ key, amount: readAmount(raw) }));
  const invalid = new Set(parsed.filter((p) => p.amount === null).map((p) => p.key));
  const allocated = parsed.reduce((s, p) => s + cents(p.amount ?? 0), 0);
  const toCredit = (cents(left) - allocated) / 100;
  const over = toCredit < 0;

  function toggle(key: string, owed: number, on: boolean) {
    setShares((s) => {
      const next = { ...s };
      if (!on) delete next[key];
      else {
        const room =
          cents(left) - Object.entries(s).reduce((sum, [k, v]) => sum + (k === key ? 0 : cents(readAmount(v) ?? 0)), 0);
        next[key] = (Math.max(0, Math.min(cents(owed), room)) / 100).toFixed(2).replace(".", ",");
      }
      return next;
    });
  }

  function submit() {
    if (!company || over || invalid.size > 0) return;
    start(async () => {
      const r = await confirmBankLineAction(line.id, {
        companyId: company.id,
        allocations: parsed
          .filter((p) => (p.amount ?? 0) > 0)
          .map((p) =>
            p.key.startsWith("i:")
              ? { invoiceId: p.key.slice(2), amount: p.amount ?? 0 }
              : { orderId: p.key.slice(2), amount: p.amount ?? 0 },
          ),
      }).catch(() => null);
      if (!r?.ok) {
        toast.error(r && !r.ok ? r.error : t("failed"));
        return;
      }
      toast.success(t("confirmed"));
      onDone();
    });
  }

  function link(receiptId: string) {
    start(async () => {
      const r = await confirmBankLineAction(line.id, { receiptIds: [receiptId] }).catch(() => null);
      if (!r?.ok) {
        toast.error(r && !r.ok ? r.error : t("failed"));
        return;
      }
      toast.success(t("confirmed"));
      onDone();
    });
  }

  const shareInput = (key: string, label: string) => (
    <Input
      aria-label={label}
      aria-invalid={invalid.has(key)}
      className={cn("h-8 w-28 text-right tabular-nums", invalid.has(key) && "border-destructive")}
      inputMode="decimal"
      value={shares[key]}
      onChange={(e) => setShares((s) => ({ ...s, [key]: e.target.value }))}
    />
  );

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

        {company && !items && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />}

        {company && items && (
          <div className="max-h-[50dvh] space-y-4 overflow-y-auto">
            {/* Money already typed by hand is linked first: a new receipt beside it counts it twice. */}
            {loose.length > 0 && (
              <div className="space-y-1.5">
                <p className="font-medium text-sm">{t("recordedByHand")}</p>
                <p className="text-muted-foreground text-xs">{t("recordedByHandHint")}</p>
                <ul className="space-y-1">
                  {loose.map((r) => (
                    <li
                      key={r.id}
                      className="flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-sm"
                    >
                      <span className="min-w-0">
                        <span className="tabular-nums">{formatMoney(r.amount, r.currency)}</span>
                        <span className="text-muted-foreground text-xs">
                          {" · "}
                          {day(r.receivedOn)}
                          {r.reference ? ` · ${r.reference}` : ""}
                        </span>
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1"
                        disabled={pending}
                        onClick={() => link(r.id)}
                      >
                        <Link2 className="size-3.5" aria-hidden /> {t("linkReceipt")}
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="space-y-2">
              <p className="font-medium text-sm">{t("openInvoices")}</p>
              {invoices.length === 0 ? (
                <p className="text-muted-foreground text-sm">{t("noOpenInvoices")}</p>
              ) : (
                <ul className="space-y-1">
                  {invoices.map((i) => {
                    const key = `i:${i.id}`;
                    const on = key in shares;
                    return (
                      <li key={i.id} className="flex items-center gap-2 rounded-md border px-2 py-1.5">
                        <Checkbox
                          id={key}
                          checked={on}
                          onCheckedChange={(v) => toggle(key, i.outstanding, v === true)}
                        />
                        <label htmlFor={key} className="min-w-0 flex-1 text-sm">
                          <span className="font-medium">{t("proposal.invoice", { number: i.number ?? "—" })}</span>
                          <span className="block text-muted-foreground text-xs">
                            {t("owes", { amount: formatMoney(i.outstanding, i.currency) })} ·{" "}
                            {t("dueOn", { date: day(i.dueDate) })}
                          </span>
                        </label>
                        {on && shareInput(key, t("proposal.invoice", { number: i.number ?? "—" }))}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {orderRows.length > 0 && (
              <div className="space-y-2">
                <p className="font-medium text-sm">{t("depositOnOrder")}</p>
                <ul className="space-y-1">
                  {orderRows.map((o) => {
                    const key = `o:${o.id}`;
                    const on = key in shares;
                    return (
                      <li key={o.id} className="flex items-center gap-2 rounded-md border px-2 py-1.5">
                        <Checkbox id={key} checked={on} onCheckedChange={(v) => toggle(key, o.owed, v === true)} />
                        <label htmlFor={key} className="min-w-0 flex-1 text-sm">
                          <span className="font-medium">{t("proposal.order", { number: o.number })}</span>
                          <span className="block text-muted-foreground text-xs">
                            {t("owes", { amount: formatMoney(o.owed, o.currency) })}
                          </span>
                        </label>
                        {on && shareInput(key, t("proposal.order", { number: o.number }))}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {credit > 0 && (
              <p className="text-muted-foreground text-xs">
                {t("creditNow", { amount: formatMoney(credit, line.currency) })}
              </p>
            )}
            <p className={over || invalid.size > 0 ? "text-destructive text-sm" : "text-muted-foreground text-sm"}>
              {invalid.size > 0
                ? t("amountInvalid")
                : over
                  ? t("overAllocated")
                  : t("toCredit", { amount: formatMoney(toCredit, line.currency) })}
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            {t("cancel")}
          </Button>
          <Button onClick={submit} disabled={!company || over || invalid.size > 0 || pending} className="gap-1.5">
            {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            {t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
