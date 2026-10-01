"use client";

import { type KeyboardEvent, useEffect, useState, useTransition } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { Check, ChevronRight, EyeOff, Loader2, RotateCcw, Undo2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";

import {
  confirmBankLineAction,
  ignoreBankLinesAction,
  restoreBankLineAction,
  undoBankLineAction,
} from "@/actions/bank";
import { StatusBadge, type Tone } from "@/components/crm/record/record-page";
import { Button } from "@/components/ui/button";
import { useCurrency } from "@/hooks/use-currency";
import type { Proposal, Reason } from "@/lib/bank/match";
import type { QueueLabels } from "@/lib/bank/reconcile";
import { cn } from "@/lib/utils";

import { BankChooseDialog } from "./bank-choose-dialog";
import type { DoneLine, OpenLine } from "./bank-view";

/** Reasons that ask a person to look before confirming: shown amber, and Enter does not confirm them. */
const WARNINGS = [
  "ambiguous",
  "other_payer",
  "contested",
  "amount_only",
  "recorded_already",
  "possible_duplicate",
  "reversal",
];

/** Whether Enter may confirm this proposal: sure, or likely with nothing to look at. */
function confirmableByKey(p: Proposal | null): boolean {
  if (!p) return false;
  if (p.confidence === "sure") return true;
  return p.confidence === "likely" && !p.reasons.some((r) => WARNINGS.includes(r.code));
}

const TONE: Record<Proposal["confidence"], Tone> = { sure: "success", likely: "info", weak: "warning" };

function useDay() {
  const format = useFormatter();
  return (day: string) =>
    format.dateTime(new Date(`${day}T12:00:00Z`), { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

/** The head of a line: amount, day, who, what they wrote. */
function LineHead({ line }: { line: OpenLine | DoneLine }) {
  const t = useTranslations("bank");
  const { formatMoney } = useCurrency();
  const day = useDay();
  return (
    <div className="min-w-0 flex-1 space-y-1">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span
          className={cn(
            "font-semibold tabular-nums",
            line.amount > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-foreground",
          )}
        >
          {formatMoney(line.amount, line.currency)}
        </span>
        <span className="text-muted-foreground text-sm">{day(line.bookedOn)}</span>
        {line.linked !== 0 && Math.abs(line.linked) < Math.abs(line.amount) && (
          <StatusBadge tone="info">{t("linked", { amount: formatMoney(line.linked, line.currency) })}</StatusBadge>
        )}
      </div>
      {line.counterpartyName && <p className="truncate font-medium text-sm">{line.counterpartyName}</p>}
      {line.remittance && <p className="line-clamp-2 break-words text-muted-foreground text-xs">{line.remittance}</p>}
    </div>
  );
}

function ReasonChips({ reasons, currency }: { reasons: Reason[]; currency: string }) {
  const tr = useTranslations("bank.reasons");
  const { formatMoney } = useCurrency();
  const text = (r: Reason) => {
    switch (r.code) {
      case "invoice_number":
      case "order_number":
        return tr(r.code, { number: r.number });
      case "amount_sum":
      case "receipt_same_amount":
        return tr(r.code, { count: r.count });
      case "credit_left":
        return tr(r.code, { amount: formatMoney(r.amount, currency) });
      case "due_near":
      case "receipt_near":
        return tr(r.code, { days: r.days });
      default:
        return tr(r.code);
    }
  };
  const warn = new Set(WARNINGS);
  return (
    <ul className="flex flex-wrap gap-1">
      {reasons.map((r, i) => (
        <li
          key={`${r.code}-${i}`}
          className={cn(
            "rounded-full border px-2 py-0.5 text-[11px] leading-4",
            warn.has(r.code) ? "border-amber-500/40 text-amber-800 dark:text-amber-300" : "text-muted-foreground",
          )}
        >
          {text(r)}
        </li>
      ))}
    </ul>
  );
}

/** What a proposal would do, in words: the customer, then each document and the credit. */
function ProposalText({ p, labels, currency }: { p: Proposal; labels: QueueLabels; currency: string }) {
  const tp = useTranslations("bank.proposal");
  const { formatMoney } = useCurrency();
  const day = useDay();
  const company = p.companyId ? labels.companies[p.companyId] : null;
  return (
    <div className="space-y-0.5 text-sm">
      <p className="font-medium">
        {company && p.companyId ? (
          <Link href={`/dashboard/companies/${p.companyId}`} className="hover:underline">
            {company}
          </Link>
        ) : (
          <span className="text-muted-foreground">{tp("unknownCompany")}</span>
        )}
      </p>
      <ul className="text-muted-foreground text-xs">
        {p.receiptIds.map((id) => {
          const r = labels.receipts[id];
          return (
            <li key={id}>
              {r ? tp("receipt", { date: day(r.receivedOn), amount: formatMoney(r.amount, currency) }) : id}
            </li>
          );
        })}
        {p.allocations.map((a) => (
          <li key={a.invoiceId ?? a.orderId}>
            {a.invoiceId ? (
              <Link href={`/dashboard/sales/invoices/${a.invoiceId}`} className="hover:underline">
                {tp("invoice", { number: labels.invoices[a.invoiceId]?.number ?? "—" })}
              </Link>
            ) : (
              <Link href={`/dashboard/sales/orders/${a.orderId}`} className="hover:underline">
                {tp("order", { number: (a.orderId && labels.orders[a.orderId]?.number) ?? "—" })}
              </Link>
            )}{" "}
            · <span className="tabular-nums">{formatMoney(a.amount, currency)}</span>
          </li>
        ))}
        {p.credit > 0 && <li>{tp("credit", { amount: formatMoney(p.credit, currency) })}</li>}
      </ul>
    </div>
  );
}

export function OpenLineRow({
  line,
  labels,
  accountId,
  outgoing = false,
  onGone,
}: {
  line: OpenLine;
  labels: QueueLabels;
  accountId: string;
  outgoing?: boolean;
  onGone: () => void;
}) {
  const t = useTranslations("bank");
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [choosing, setChoosing] = useState(false);
  const [pending, start] = useTransition();
  // The proposals change when the queue is read again: the shown one resets to the best.
  const proposalsKey = line.proposals.map((x) => x.key).join(";");
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the proposals change
  useEffect(() => setIndex(0), [proposalsKey]);
  const p = line.proposals[index] ?? line.proposals[0] ?? null;

  function run(action: () => Promise<{ ok: boolean; error?: string } | null>, success: string) {
    onGone();
    start(async () => {
      const r = await action().catch(() => null);
      if (r?.ok) toast.success(success);
      else toast.error(r?.error ?? t("failed"));
      router.refresh();
    });
  }

  const confirm = () =>
    p &&
    // A weak proposal is a guess: confirmed only after the person says so.
    (p.confidence !== "weak" || window.confirm(t("confirmWeak"))) &&
    run(
      () =>
        confirmBankLineAction(line.id, {
          receiptIds: p.receiptIds,
          companyId: p.companyId,
          allocations: p.allocations,
        }),
      t("confirmed"),
    );
  const ignore = () => run(() => ignoreBankLinesAction(accountId, [line.id]), t("ignoredCount", { count: 1 }));

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return;
    const rows = [...(e.currentTarget.parentElement?.querySelectorAll<HTMLElement>("[data-line]") ?? [])];
    const at = rows.indexOf(e.currentTarget);
    if (e.key === "ArrowDown" || e.key === "j") {
      e.preventDefault();
      rows[at + 1]?.focus();
    } else if (e.key === "ArrowUp" || e.key === "k") {
      e.preventDefault();
      rows[at - 1]?.focus();
    } else if (e.key === "Enter" && !e.repeat && confirmableByKey(p)) {
      e.preventDefault();
      confirm();
    } else if ((e.key === "i" || e.key === "I") && !e.repeat) {
      e.preventDefault();
      ignore();
    }
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a line is a keyboard stop, worked with Enter and I
    <div
      data-line
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the same stop: ↑ ↓ move between lines
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-busy={pending}
      className="rounded-lg border bg-card p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-4"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:gap-6">
        <LineHead line={line} />
        <div className="space-y-2 lg:w-[26rem] lg:shrink-0">
          {p ? (
            <>
              <div className="flex items-start justify-between gap-2">
                <ProposalText p={p} labels={labels} currency={line.currency} />
                <StatusBadge tone={TONE[p.confidence]} className="shrink-0">
                  {t(`confidence.${p.confidence}`)}
                </StatusBadge>
              </div>
              <ReasonChips reasons={p.reasons} currency={line.currency} />
            </>
          ) : (
            <p className="text-muted-foreground text-sm">{outgoing ? t("outgoingHint") : t("noProposal")}</p>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            {p && (
              <Button size="sm" className="gap-1.5" onClick={confirm} disabled={pending}>
                {pending ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <Check className="size-3.5" aria-hidden />
                )}
                {t("confirm")}
              </Button>
            )}
            {line.proposals.length > 1 && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1"
                onClick={() => setIndex((i) => (i + 1) % line.proposals.length)}
              >
                {t("otherProposals", { count: line.proposals.length - 1 })}
                <ChevronRight className="size-3.5" aria-hidden />
              </Button>
            )}
            {!outgoing && (
              <Button size="sm" variant="outline" onClick={() => setChoosing(true)} disabled={pending}>
                {t("choose")}
              </Button>
            )}
            <Button size="sm" variant="ghost" className="gap-1.5" onClick={ignore} disabled={pending}>
              <EyeOff className="size-3.5" aria-hidden /> {t("ignore")}
            </Button>
          </div>
        </div>
      </div>
      {choosing && (
        <BankChooseDialog
          open={choosing}
          onOpenChange={setChoosing}
          line={line}
          initialCompany={p?.companyId ? { id: p.companyId, name: labels.companies[p.companyId] ?? "" } : null}
          onDone={() => {
            setChoosing(false);
            onGone();
          }}
        />
      )}
    </div>
  );
}

export function DoneLineRow({ line, state }: { line: DoneLine; state: "reconciled" | "ignored" }) {
  const t = useTranslations("bank");
  const tp = useTranslations("bank.proposal");
  const router = useRouter();
  const { formatMoney } = useCurrency();
  const [pending, start] = useTransition();

  function act() {
    if (state === "reconciled" && !window.confirm(t("undoConfirm"))) return;
    start(async () => {
      const r = await (state === "reconciled" ? undoBankLineAction(line.id) : restoreBankLineAction(line.id)).catch(
        () => null,
      );
      if (r?.ok) toast.success(state === "reconciled" ? t("undone") : t("restored"));
      else toast.error(r && !r.ok ? r.error : t("failed"));
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-3 sm:p-4 lg:flex-row lg:items-start lg:gap-6">
      <LineHead line={line} />
      <div className="space-y-2 lg:w-[26rem] lg:shrink-0">
        {line.receipts.map((r) => (
          <div key={r.id} className="text-sm">
            <p className="font-medium">
              {r.companyId ? (
                <Link href={`/dashboard/companies/${r.companyId}`} className="hover:underline">
                  {r.companyName}
                </Link>
              ) : (
                <span className="text-muted-foreground">{tp("unknownCompany")}</span>
              )}
            </p>
            <p className="text-muted-foreground text-xs">
              <span className="tabular-nums">{formatMoney(r.amount, line.currency)}</span> ·{" "}
              {r.source === "bank" ? t("fromBank") : t("byHand")}
              {r.invoices.map((i) => (
                <span key={i.id}>
                  {" · "}
                  <Link href={`/dashboard/sales/invoices/${i.id}`} className="hover:underline">
                    {tp("invoice", { number: i.number ?? "—" })}
                  </Link>
                </span>
              ))}
              {r.orders.map((o) => (
                <span key={o.id}>
                  {" · "}
                  <Link href={`/dashboard/sales/orders/${o.id}`} className="hover:underline">
                    {tp("order", { number: o.number ?? "—" })}
                  </Link>
                </span>
              ))}
            </p>
          </div>
        ))}
        <Button size="sm" variant="outline" className="gap-1.5" onClick={act} disabled={pending}>
          {state === "reconciled" ? (
            <Undo2 className="size-3.5" aria-hidden />
          ) : (
            <RotateCcw className="size-3.5" aria-hidden />
          )}
          {state === "reconciled" ? t("undo") : t("restore")}
        </Button>
      </div>
    </div>
  );
}
