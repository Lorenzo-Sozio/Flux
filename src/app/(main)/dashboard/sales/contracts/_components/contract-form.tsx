"use client";

import { useMemo, useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronLeft, Loader2, ScrollText } from "lucide-react";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { createContract, type getContractFormData, updateContract } from "@/actions/contracts";
import { ContractFormSchema, type ContractFormValues } from "@/actions/contracts-validation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useCurrency } from "@/hooks/use-currency";
import {
  addDays,
  BILLING_PERIODS,
  contractPhase,
  currentTermEnd,
  monthlyValue,
  noticeDeadline,
  REMINDER_LEAD_DAYS,
  today,
} from "@/lib/contract-terms";

type FormData = Awaited<ReturnType<typeof getContractFormData>>;

export interface ContractInitial extends Partial<ContractFormValues> {
  id: string;
}

/**
 * Writing a contract.
 *
 * Built to the same plan as the quote form rather than as a dialog: a bar that
 * stays put with the recurring value in it, then who it is for, what it is worth,
 * and how long it runs, each in its own card with room for the explanation.
 *
 * ⚠️ The term, the notice and the renewal are the part people get wrong, so the
 * page works out what it will mean — when it ends, when it will ask for a decision
 * — and says it under the fields, rather than leaving three dates to be held in
 * the head.
 */
export function ContractForm({ initial, data }: { initial: ContractInitial | null; data: FormData | null }) {
  const t = useTranslations("contracts");
  const tf = useTranslations("contracts.form");
  const router = useRouter();
  const { formatAmount } = useCurrency();
  const [saving, setSaving] = useState(false);

  const form = useForm<ContractFormValues>({
    resolver: zodResolver(ContractFormSchema),
    defaultValues: {
      title: initial?.title ?? "",
      companyId: initial?.companyId ?? "",
      contactId: initial?.contactId ?? "",
      ownerId: initial?.ownerId ?? "",
      status: initial?.status ?? "active",
      amount: initial?.amount ?? 0,
      currency: initial?.currency ?? "EUR",
      billingPeriod: initial?.billingPeriod ?? "annual",
      startDate: initial?.startDate ?? today(),
      endDate: initial?.endDate ?? "",
      autoRenew: initial?.autoRenew ?? false,
      renewalTermMonths: initial?.renewalTermMonths ?? 12,
      noticeDays: initial?.noticeDays ?? 30,
      notes: initial?.notes ?? "",
    },
  });

  const values = form.watch();
  const companyId = values.companyId;

  /** Contacts of the chosen company, or all of them while none is chosen. */
  const contactOptions = useMemo(() => {
    const all = data?.contacts ?? [];
    const list = companyId ? all.filter((c) => c.companyId === companyId) : all;
    return list.map((c) => ({ value: c.id, label: `${c.firstName} ${c.lastName}`.trim() }));
  }, [data?.contacts, companyId]);

  // What the dates will mean, worked out while they are typed.
  const preview = useMemo(() => {
    const terms = {
      status: values.status ?? "active",
      amount: Number(values.amount) || 0,
      billingPeriod: values.billingPeriod ?? "annual",
      startDate: values.startDate || today(),
      endDate: values.endDate || null,
      autoRenew: Boolean(values.autoRenew),
      renewalTermMonths: Number(values.renewalTermMonths) || null,
      noticeDays: Number(values.noticeDays) || 0,
    } as const;
    const on = today();
    const termEnd = currentTermEnd(terms, on);
    return {
      monthly: monthlyValue(terms),
      phase: contractPhase(terms, on),
      termEnd,
      noticeBy: termEnd ? noticeDeadline(termEnd, terms.noticeDays) : null,
      asksFrom: termEnd ? addDays(noticeDeadline(termEnd, terms.noticeDays), -REMINDER_LEAD_DAYS) : null,
    };
  }, [values]);

  const submit = async (input: ContractFormValues) => {
    setSaving(true);
    try {
      // The schema's defaults live in its output type; the form is typed by its
      // input, where they are optional, so they are filled in here too.
      const payload = {
        ...input,
        status: input.status ?? "active",
        currency: input.currency || "EUR",
        billingPeriod: input.billingPeriod ?? "annual",
        autoRenew: Boolean(input.autoRenew),
        contactId: input.contactId || null,
        ownerId: input.ownerId || null,
        endDate: input.endDate || null,
        renewalTermMonths: input.autoRenew ? Number(input.renewalTermMonths) : null,
        amount: Number(input.amount),
        noticeDays: Number(input.noticeDays),
        notes: input.notes ?? null,
      };
      const result = initial ? await updateContract(initial.id, payload) : await createContract(payload);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t("saved"));
      router.push("/dashboard/sales/contracts");
      router.refresh();
    } catch {
      toast.error(t("failed"));
    } finally {
      setSaving(false);
    }
  };

  const label = (key: string, required = false) => (
    <FormLabel className="text-xs">
      {tf(key)}
      {required && <span className="ml-0.5 text-destructive">*</span>}
    </FormLabel>
  );

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)} className="space-y-6">
        {/* ── The bar that stays put: where you are, what it is worth, what to do ── */}
        <div className="-mx-4 sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b bg-background/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Button asChild type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0">
              <Link href="/dashboard/sales/contracts" aria-label={t("back")}>
                <ChevronLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <ScrollText className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate font-bold text-lg tracking-tight">{initial ? t("edit") : t("newContract")}</h1>
              <p className="hidden truncate text-muted-foreground text-xs sm:block">{tf("subtitle")}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="mr-2 hidden items-baseline gap-2 sm:flex">
              <span className="text-muted-foreground text-xs uppercase tracking-wide">{t("monthly")}</span>
              <span className="font-bold text-base tabular-nums">{formatAmount(preview.monthly)}</span>
            </div>
            <Button type="button" variant="ghost" onClick={() => router.push("/dashboard/sales/contracts")}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={saving} className="gap-2">
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t("save")}
            </Button>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-12">
          {/* ── Who it is with ── */}
          <Card className="md:col-span-6">
            <CardHeader>
              <CardTitle className="font-semibold text-muted-foreground text-sm uppercase tracking-wide">
                {tf("customerTitle")}
              </CardTitle>
              <CardDescription>{tf("customerSubtitle")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    {label("title", true)}
                    <FormControl>
                      <Input {...field} placeholder={tf("titlePlaceholder")} className="h-9" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="companyId"
                render={({ field }) => (
                  <FormItem>
                    {label("company", true)}
                    <FormControl>
                      <SearchableSelect
                        options={(data?.companies ?? []).map((c) => ({ value: c.id, label: c.name }))}
                        value={field.value}
                        onChange={(v) => {
                          field.onChange(v);
                          // A contact from the previous company is worse than none.
                          form.setValue("contactId", "");
                        }}
                        placeholder={tf("companyPlaceholder")}
                        className="h-9"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="contactId"
                render={({ field }) => (
                  <FormItem>
                    {label("contact")}
                    <FormControl>
                      <SearchableSelect
                        options={contactOptions}
                        value={field.value ?? ""}
                        onChange={field.onChange}
                        placeholder={tf("contactPlaceholder")}
                        className="h-9"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="ownerId"
                render={({ field }) => (
                  <FormItem>
                    {label("owner")}
                    <FormControl>
                      <SearchableSelect
                        options={(data?.users ?? []).map((u) => ({ value: u.id, label: u.name ?? u.email ?? u.id }))}
                        value={field.value ?? ""}
                        onChange={field.onChange}
                        placeholder={tf("ownerPlaceholder")}
                        className="h-9"
                      />
                    </FormControl>
                    <p className="text-muted-foreground text-xs">{tf("ownerHint")}</p>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* ── What it is worth ── */}
          <Card className="md:col-span-6">
            <CardHeader>
              <CardTitle className="font-semibold text-muted-foreground text-sm uppercase tracking-wide">
                {tf("valueTitle")}
              </CardTitle>
              <CardDescription>{tf("valueSubtitle")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="amount"
                  render={({ field }) => (
                    <FormItem>
                      {label("amount", true)}
                      <FormControl>
                        <Input {...field} inputMode="decimal" className="h-9 text-right tabular-nums" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="billingPeriod"
                  render={({ field }) => (
                    <FormItem>
                      {label("billingPeriod", true)}
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="h-9">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {BILLING_PERIODS.map((p) => (
                            <SelectItem key={p} value={p}>
                              {t(`periods.${p}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="currency"
                  render={({ field }) => (
                    <FormItem>
                      {label("currency")}
                      <FormControl>
                        <Input {...field} maxLength={3} className="h-9 uppercase" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      {label("status")}
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="h-9">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {(["draft", "active", "cancelled"] as const).map((s) => (
                            <SelectItem key={s} value={s}>
                              {t(`statuses.${s}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="rounded-md bg-muted/50 p-3 text-sm">
                <div className="flex items-baseline justify-between">
                  <span className="text-muted-foreground text-xs uppercase tracking-wide">{tf("perMonth")}</span>
                  <span className="font-semibold tabular-nums">{formatAmount(preview.monthly)}</span>
                </div>
                <div className="mt-1 flex items-baseline justify-between">
                  <span className="text-muted-foreground text-xs uppercase tracking-wide">{tf("perYear")}</span>
                  <span className="tabular-nums">{formatAmount(preview.monthly * 12)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ── How long it runs ── */}
          <Card className="md:col-span-12">
            <CardHeader>
              <CardTitle className="font-semibold text-muted-foreground text-sm uppercase tracking-wide">
                {tf("termTitle")}
              </CardTitle>
              <CardDescription>{tf("termSubtitle")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <FormField
                  control={form.control}
                  name="startDate"
                  render={({ field }) => (
                    <FormItem>
                      {label("startDate", true)}
                      <FormControl>
                        <Input {...field} type="date" className="h-9" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="endDate"
                  render={({ field }) => (
                    <FormItem>
                      {label("endDate")}
                      <FormControl>
                        <Input {...field} type="date" className="h-9" />
                      </FormControl>
                      <p className="text-muted-foreground text-xs">{tf("endDateHint")}</p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="noticeDays"
                  render={({ field }) => (
                    <FormItem>
                      {label("noticeDays")}
                      <FormControl>
                        <Input {...field} type="number" min={0} max={365} className="h-9" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="renewalTermMonths"
                  render={({ field }) => (
                    <FormItem>
                      {label("renewalTermMonths")}
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          min={1}
                          max={120}
                          disabled={!values.autoRenew}
                          className="h-9"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="autoRenew"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-3 space-y-0 rounded-md border p-3">
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                    <div className="min-w-0">
                      <FormLabel className="cursor-pointer">{tf("autoRenew")}</FormLabel>
                      <p className="text-muted-foreground text-xs">{tf("autoRenewHint")}</p>
                    </div>
                  </FormItem>
                )}
              />

              {/* What those dates will mean, rather than three dates to hold in the head. */}
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md bg-muted/50 p-3 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground text-xs uppercase tracking-wide">{t("status")}</span>
                  <Badge variant="outline">{t(`phases.${preview.phase}`)}</Badge>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground text-xs uppercase tracking-wide">{t("termEnd")}</span>
                  <span className="tabular-nums">{preview.termEnd ?? tf("noEnd")}</span>
                </div>
                {preview.noticeBy && (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground text-xs uppercase tracking-wide">{t("noticeBy")}</span>
                      <span className="tabular-nums">{preview.noticeBy}</span>
                    </div>
                    <p className="text-muted-foreground text-xs">{tf("asksFrom", { date: preview.asksFrom ?? "" })}</p>
                  </>
                )}
              </div>

              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    {label("notes")}
                    <FormControl>
                      <Textarea {...field} rows={3} placeholder={tf("notesPlaceholder")} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>
        </div>
      </form>
    </Form>
  );
}
