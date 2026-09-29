"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { useRouter } from "next/navigation";

import { CheckCheck, Landmark, Loader2, MoreHorizontal, Plus, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import {
  archiveBankAccountAction,
  confirmSureAction,
  type getBankOverview,
  ignoreBankLinesAction,
} from "@/actions/bank";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useCurrency } from "@/hooks/use-currency";
import { cn } from "@/lib/utils";

import { BankAccountDialog } from "./bank-account-dialog";
import { BankImportDialog } from "./bank-import-dialog";
import { DoneLineRow, OpenLineRow } from "./bank-line";

export type Overview = NonNullable<Awaited<ReturnType<typeof getBankOverview>>>;
export type Account = Overview["accounts"][number];
export type QueueData = NonNullable<Overview["queue"]>;
export type OpenLine = QueueData["open"][number];
export type DoneLine = Overview["reconciled"][number];

type Tab = "open" | "outgoing" | "reconciled" | "ignored";

/**
 * The reconciliation screen (I13). One list per state; the queue is worked from the keyboard —
 * ↑ ↓ between lines, Enter confirms the proposal shown, I ignores — and a line leaves the list the
 * moment it is dealt with, before the server has answered.
 */
export function BankView({ data }: { data: Overview | null }) {
  const t = useTranslations("bank");
  const { formatMoney } = useCurrency();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("open");
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [accountDialog, setAccountDialog] = useState<"new" | "edit" | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [bulkPending, startBulk] = useTransition();
  const listRef = useRef<HTMLDivElement>(null);
  const focusAfter = useRef<number | null>(null);

  // A fresh answer from the server replaces what was hidden while waiting for it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on new data only
  useEffect(() => {
    setGone(new Set());
    if (focusAfter.current !== null) {
      const rows = listRef.current?.querySelectorAll<HTMLElement>("[data-line]");
      rows?.[Math.min(focusAfter.current, rows.length - 1)]?.focus();
      focusAfter.current = null;
    }
  }, [data]);

  const account = data?.account ?? null;
  const queue = data?.queue ?? null;
  const open = useMemo(() => (queue?.open ?? []).filter((l) => !gone.has(l.id)), [queue, gone]);
  const outgoing = useMemo(() => (queue?.outgoing ?? []).filter((l) => !gone.has(l.id)), [queue, gone]);
  const sure = open.filter((l) => l.proposals[0]?.confidence === "sure");

  if (!data) return null;

  function hide(id: string, index: number) {
    const wasFocused = document.activeElement?.closest("[data-line]") !== null;
    focusAfter.current = wasFocused ? index : null;
    setGone((g) => new Set(g).add(id));
    // The next line takes the focus at once: working down the queue does not wait for the server.
    if (wasFocused)
      requestAnimationFrame(() => listRef.current?.querySelectorAll<HTMLElement>("[data-line]")[index]?.focus());
  }

  function confirmSure() {
    if (!account) return;
    // Receipts written in one click: the person sees how many and how much before they are.
    const total = sure.reduce((sum, l) => sum + (l.amount - l.linked), 0);
    const currency = sure[0]?.currency ?? "EUR";
    if (
      !window.confirm(
        `${t("confirmSureTitle", { count: sure.length })}
${t("confirmSureText", { total: formatMoney(total, currency) })}`,
      )
    )
      return;
    const picks = sure.map((l) => ({ transactionId: l.id, key: l.proposals[0].key }));
    startBulk(async () => {
      let confirmed = 0;
      let changed = 0;
      // A handful of statements per line: sent fifty at a time.
      for (let i = 0; i < picks.length; i += 50) {
        const r = await confirmSureAction(account.id, picks.slice(i, i + 50)).catch(() => null);
        if (!r?.ok) {
          toast.error(r && !r.ok ? r.error : t("failed"));
          break;
        }
        confirmed += r.confirmed;
        changed += r.changed + r.failed;
      }
      if (confirmed > 0) toast.success(t("bulkDone", { confirmed }));
      if (changed > 0) toast.warning(t("bulkChanged", { changed }));
      router.refresh();
    });
  }

  function ignoreAllOutgoing() {
    // A payment returned unpaid is not a charge: it stays for a person to deal with.
    const plain = outgoing.filter((l) => !l.reversal);
    if (!account || plain.length === 0) return;
    if (!window.confirm(t("ignoreAllConfirm", { count: plain.length }))) return;
    const ids = plain.map((l) => l.id);
    setGone((g) => new Set([...g, ...ids]));
    startBulk(async () => {
      const r = await ignoreBankLinesAction(account.id, ids).catch(() => null);
      if (r?.ok) toast.success(t("ignoredCount", { count: r.ignored }));
      else toast.error(r && !r.ok ? r.error : t("failed"));
      router.refresh();
    });
  }

  async function archive() {
    if (!account || !window.confirm(t("archiveConfirm", { name: account.name }))) return;
    const r = await archiveBankAccountAction(account.id).catch(() => null);
    if (!r?.ok) toast.error(r && !r.ok ? r.error : t("failed"));
    router.push("/dashboard/sales/bank");
    router.refresh();
  }

  const counts = queue?.counts ?? { open: 0, outgoing: 0, reconciled: 0, ignored: 0 };
  const hidden = {
    open: queue ? queue.open.length - open.length : 0,
    outgoing: queue ? queue.outgoing.length - outgoing.length : 0,
  };
  const tabs: { id: Tab; count: number }[] = [
    { id: "open", count: Math.max(0, counts.open - hidden.open) },
    { id: "outgoing", count: Math.max(0, counts.outgoing - hidden.outgoing) },
    { id: "reconciled", count: counts.reconciled },
    { id: "ignored", count: counts.ignored },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-bold text-2xl tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>
        </div>
        {account && (
          <div className="flex flex-wrap items-center gap-2">
            {data.accounts.length > 1 && (
              <NativeSelect
                size="sm"
                aria-label={t("account")}
                value={account.id}
                onChange={(e) => router.push(`/dashboard/sales/bank?account=${encodeURIComponent(e.target.value)}`)}
              >
                {data.accounts.map((a) => (
                  <NativeSelectOption key={a.id} value={a.id}>
                    {a.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
            <Button size="sm" className="gap-1.5" onClick={() => setImportOpen(true)}>
              <Upload className="size-3.5" aria-hidden /> {t("import")}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" aria-label={t("account")}>
                  <MoreHorizontal className="size-4" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setAccountDialog("edit")}>{t("editAccount")}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setAccountDialog("new")}>{t("addAccount")}</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive" onSelect={archive}>
                  {t("archiveAccount")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {!account ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Landmark className="size-8 text-muted-foreground" aria-hidden />
            <p className="font-medium">{t("noAccountTitle")}</p>
            <p className="max-w-md text-muted-foreground text-sm">{t("noAccountText")}</p>
            <Button className="mt-2 gap-1.5" onClick={() => setAccountDialog("new")}>
              <Plus className="size-4" aria-hidden /> {t("addAccount")}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* On a phone four equal columns, the count under the label: a row that wrapped left
                one tab alone on a second line. */}
            <div
              role="tablist"
              aria-label={t("title")}
              className="grid w-full grid-cols-4 gap-1 rounded-lg bg-muted p-1 sm:inline-flex sm:w-auto"
            >
              {tabs.map((x) => (
                <button
                  key={x.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === x.id}
                  onClick={() => setTab(x.id)}
                  className={cn(
                    "flex min-w-0 flex-col items-center rounded-md px-2 py-1.5 font-medium text-xs leading-tight transition-colors sm:flex-row sm:gap-1.5 sm:px-3 sm:text-sm",
                    tab === x.id ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <span className="max-w-full text-center [overflow-wrap:anywhere]">{t(`tabs.${x.id}`)}</span>
                  <span className="text-muted-foreground tabular-nums">{x.count}</span>
                </button>
              ))}
            </div>
            {tab === "open" && sure.length > 0 && (
              <Button size="sm" className="gap-1.5" onClick={confirmSure} disabled={bulkPending} title={t("sureHint")}>
                {bulkPending ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <CheckCheck className="size-3.5" aria-hidden />
                )}
                {t("confirmSure", { count: sure.length })}
              </Button>
            )}
            {tab === "outgoing" && outgoing.length > 0 && (
              <Button size="sm" variant="outline" onClick={ignoreAllOutgoing} disabled={bulkPending}>
                {t("ignoreAll")}
              </Button>
            )}
          </div>

          <div ref={listRef} className="space-y-2">
            {tab === "open" &&
              (open.length === 0 ? (
                <Empty text={t("emptyOpen")} />
              ) : (
                <>
                  <p className="hidden text-muted-foreground text-xs md:block">{t("keyboardHint")}</p>
                  {open.map((l, i) => (
                    <OpenLineRow
                      key={l.id}
                      line={l}
                      labels={queue?.labels ?? { companies: {}, invoices: {}, orders: {}, receipts: {} }}
                      accountId={account.id}
                      onGone={() => hide(l.id, i)}
                    />
                  ))}
                </>
              ))}
            {tab === "outgoing" &&
              (outgoing.length === 0 ? (
                <Empty text={t("emptyOutgoing")} />
              ) : (
                <>
                  <p className="text-muted-foreground text-xs">{t("outgoingHint")}</p>
                  {outgoing.map((l, i) => (
                    <OpenLineRow
                      key={l.id}
                      line={l}
                      labels={queue?.labels ?? { companies: {}, invoices: {}, orders: {}, receipts: {} }}
                      accountId={account.id}
                      outgoing
                      onGone={() => hide(l.id, i)}
                    />
                  ))}
                </>
              ))}
            {tab === "reconciled" &&
              (data.reconciled.length === 0 ? (
                <Empty text={t("emptyReconciled")} />
              ) : (
                data.reconciled.map((l) => <DoneLineRow key={l.id} line={l} state="reconciled" />)
              ))}
            {tab === "ignored" &&
              (data.ignored.length === 0 ? (
                <Empty text={t("emptyIgnored")} />
              ) : (
                data.ignored.map((l) => <DoneLineRow key={l.id} line={l} state="ignored" />)
              ))}
          </div>
        </>
      )}

      <BankAccountDialog
        open={accountDialog !== null}
        onOpenChange={(o) => !o && setAccountDialog(null)}
        account={accountDialog === "edit" ? account : null}
      />
      {account && <BankImportDialog open={importOpen} onOpenChange={setImportOpen} account={account} />}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">{text}</p>;
}
