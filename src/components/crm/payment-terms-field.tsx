"use client";

import { Plus, Trash2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  type Installment,
  installmentsFor,
  installmentsMatch,
  MAX_INSTALLMENTS,
  type PaymentTerms,
  TERM_PRESET_KEYS,
} from "@/lib/payment-terms";

/**
 * An invoice's payment terms (I12): one payment on a date (the form's own due date field), a
 * preset worked out from the issue date, or installments written by hand. A preset shows what it
 * will become if the invoice is issued today; the dates are fixed only at issue.
 */
export function PaymentTermsField({
  terms,
  onChange,
  total,
  today,
  money,
  id = "payment-terms",
}: {
  terms: PaymentTerms | null;
  onChange: (terms: PaymentTerms | null) => void;
  total: number;
  /** The day the preview counts from: the issue date is only known at issue. */
  today: string;
  money: (n: number) => string;
  id?: string;
}) {
  const t = useTranslations("invoices.terms");
  const format = useFormatter();
  const day = (d: string) =>
    format.dateTime(new Date(`${d}T12:00:00Z`), { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

  const mode = !terms ? "single" : "preset" in terms ? terms.preset : "custom";
  const plan: Installment[] = terms ? installmentsFor(terms, today, total) : [];
  const custom = terms && "custom" in terms ? terms.custom : null;
  const sum = custom ? Math.round(custom.reduce((s, i) => s + i.amount, 0) * 100) / 100 : 0;

  function choose(value: string) {
    if (value === "single") onChange(null);
    else if (value === "custom")
      // Written by hand, starting from what is on screen: the preset's installments, or two halves.
      onChange({
        custom: plan.length > 1 ? plan : installmentsFor({ preset: "d30_60eom" }, today, total),
      });
    else onChange({ preset: value as (typeof TERM_PRESET_KEYS)[number] });
  }

  function edit(index: number, patch: Partial<{ dueDate: string; amount: string }>) {
    if (!custom) return;
    const next = custom.map((i, k) =>
      k === index
        ? {
            dueDate: patch.dueDate ?? i.dueDate,
            amount: patch.amount !== undefined ? Number(patch.amount.replace(",", ".")) || 0 : i.amount,
          }
        : i,
    );
    onChange({ custom: next });
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{t("label")}</Label>
      <NativeSelect id={id} className="w-full" value={mode} onChange={(e) => choose(e.target.value)}>
        <NativeSelectOption value="single">{t("single")}</NativeSelectOption>
        {TERM_PRESET_KEYS.map((k) => (
          <NativeSelectOption key={k} value={k}>
            {t(`presets.${k}`)}
          </NativeSelectOption>
        ))}
        <NativeSelectOption value="custom">{t("custom")}</NativeSelectOption>
      </NativeSelect>

      {terms && !custom && (
        <div className="rounded-md border bg-muted/40 p-2 text-sm">
          <ul className="space-y-0.5">
            {plan.map((i, k) => (
              <li key={i.dueDate} className="flex justify-between gap-3 tabular-nums">
                <span>
                  {t("installment", { n: k + 1 })} · {day(i.dueDate)}
                </span>
                <span>{money(i.amount)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-muted-foreground text-xs">{t("fromIssue")}</p>
        </div>
      )}

      {custom && (
        <div className="space-y-2">
          {custom.map((i, k) => (
            <div key={`${k}-${custom.length}`} className="flex items-center gap-2">
              <Input
                type="date"
                aria-label={t("dueDateOf", { n: k + 1 })}
                value={i.dueDate}
                onChange={(e) => edit(k, { dueDate: e.target.value })}
                className="min-w-0 flex-1"
              />
              <Input
                inputMode="decimal"
                aria-label={t("amountOf", { n: k + 1 })}
                defaultValue={i.amount.toFixed(2)}
                onBlur={(e) => edit(k, { amount: e.target.value })}
                className="w-28 text-right tabular-nums"
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={t("remove", { n: k + 1 })}
                disabled={custom.length <= 1}
                onClick={() => onChange({ custom: custom.filter((_, j) => j !== k) })}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={custom.length >= MAX_INSTALLMENTS}
              onClick={() =>
                onChange({
                  custom: [
                    ...custom,
                    {
                      dueDate: custom[custom.length - 1]?.dueDate ?? today,
                      amount: Math.max(0, Math.round((total - sum) * 100) / 100),
                    },
                  ],
                })
              }
            >
              <Plus className="size-3.5" aria-hidden /> {t("add")}
            </Button>
            <p
              className={
                installmentsMatch(custom, total) ? "text-muted-foreground text-xs" : "text-destructive text-xs"
              }
            >
              {installmentsMatch(custom, total)
                ? t("matches", { total: money(total) })
                : t("mismatch", { sum: money(sum), total: money(total) })}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
