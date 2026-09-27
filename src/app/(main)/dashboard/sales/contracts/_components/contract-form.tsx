"use client";

import { useMemo, useState } from "react";

import { useRouter } from "next/navigation";

import { zodResolver } from "@hookform/resolvers/zod";
import { Building2, CalendarRange, Coins, Loader2, NotebookPen, RefreshCw, User, UserRound } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { createContract, type getContractFormData, updateContract } from "@/actions/contracts";
import { ContractFormSchema, type ContractFormValues } from "@/actions/contracts-validation";
import {
  MetaItem,
  Metric,
  MetricStrip,
  RecordBackLink,
  RecordHero,
  StatusBadge,
  type Tone,
} from "@/components/crm/record/record-page";
import { RecordTabBar } from "@/components/crm/record/record-sections";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CurrencySelect } from "@/components/ui/currency-select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useCurrency } from "@/hooks/use-currency";
import { useMessageText } from "@/hooks/use-message-text";
import {
  addDays,
  BILLING_PERIODS,
  type ContractPhase,
  contractPhase,
  currentTermEnd,
  monthlyValue,
  noticeDeadline,
  REMINDER_LEAD_DAYS,
  today,
} from "@/lib/contract-terms";
import { cn } from "@/lib/utils";

type FormData = Awaited<ReturnType<typeof getContractFormData>>;

export interface ContractInitial extends Partial<ContractFormValues> {
  id: string;
}

/** The kit's five tones, matched to the badges on the contracts list. */
const PHASE_TONE: Record<ContractPhase, Tone> = {
  active: "success",
  renewal_due: "warning",
  expired: "danger",
  upcoming: "info",
  draft: "neutral",
  cancelled: "neutral",
};

const DAY = 86_400_000;

/** Whole days from one calendar day to another; both are UTC `yyyy-mm-dd`, as contract-terms keeps them. */
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY);

/**
 * Writing a contract, and — once it exists — the contract's page.
 *
 * There is no separate detail view: opening a contract opens this. So in edit mode
 * it starts with the same hero every record has — the phase, the title, who it is
 * with — and the figures that decide what happens next: what it brings in a month,
 * when the term ends and by when notice must be given, each with how far away it
 * is. Below, one card per subject: who, what it is worth, how long it runs, notes.
 * Save and cancel stay at the bottom edge, where the thumb is.
 *
 * ⚠️ The term, the notice and the renewal are the part people get wrong, so the
 * page works out what it will mean — when it ends, when it will ask for a decision
 * — and says it under the fields, rather than leaving three dates to be held in
 * the head. The hero's figures follow the fields for the same reason: a date
 * changed is seen to move the deadline before it is saved.
 *
 * ⚠️ Shared with /contracts/new (`initial` null): the hero then has no status and
 * no customer to show, and the submit creates instead of updating.
 */
type FormSection = "customer" | "value" | "term" | "notes";

/** Which phone tab holds each field, so a failed save can open the right one. */
const FIELDS_OF: Record<FormSection, (keyof ContractFormValues)[]> = {
  customer: ["title", "companyId", "contactId", "ownerId"],
  value: ["amount", "billingPeriod", "currency", "status"],
  term: ["startDate", "endDate", "noticeDays", "renewalTermMonths", "autoRenew"],
  notes: ["notes"],
};
const SECTION_OF = Object.fromEntries(
  Object.entries(FIELDS_OF).flatMap(([section, fields]) => fields.map((f) => [f, section])),
) as Partial<Record<keyof ContractFormValues, FormSection>>;

export function ContractForm({ initial, data }: { initial: ContractInitial | null; data: FormData | null }) {
  const t = useTranslations("contracts");
  const tf = useTranslations("contracts.form");
  const tR = useTranslations("record");
  const formatter = useFormatter();
  const say = useMessageText();
  const router = useRouter();
  const { formatMoney } = useCurrency();
  const [saving, setSaving] = useState(false);
  // Which card a phone shows. The form is one form whatever is on screen: every
  // field stays mounted and is submitted, only hidden.
  const [section, setSection] = useState<FormSection>("customer");

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
  const currency = values.currency || "EUR";

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
      on,
      monthly: monthlyValue(terms),
      phase: contractPhase(terms, on),
      termEnd,
      noticeBy: termEnd ? noticeDeadline(termEnd, terms.noticeDays) : null,
      asksFrom: termEnd ? addDays(noticeDeadline(termEnd, terms.noticeDays), -REMINDER_LEAD_DAYS) : null,
    };
  }, [values]);

  // The contract as it is saved, for the hero's identity: a title that changed
  // with every keystroke would make the heading of the page flicker.
  const saved = useMemo(() => {
    if (!initial) return null;
    const on = today();
    const phase = contractPhase(
      {
        status: initial.status ?? "active",
        amount: Number(initial.amount) || 0,
        billingPeriod: initial.billingPeriod ?? "annual",
        startDate: initial.startDate || on,
        endDate: initial.endDate || null,
        autoRenew: Boolean(initial.autoRenew),
        renewalTermMonths: Number(initial.renewalTermMonths) || null,
        noticeDays: Number(initial.noticeDays) || 0,
      },
      on,
    );
    const company = data?.companies.find((c) => c.id === initial.companyId);
    const contact = data?.contacts.find((c) => c.id === initial.contactId);
    const owner = data?.users.find((u) => u.id === initial.ownerId);
    return {
      phase,
      company,
      contactName: contact ? `${contact.firstName} ${contact.lastName}`.trim() : null,
      ownerName: owner ? (owner.name ?? owner.email) : null,
    };
  }, [initial, data]);

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
        toast.error(say(result));
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

  const day = (d: string) =>
    formatter.dateTime(new Date(`${d}T00:00:00Z`), {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });

  /** "in 12 days", "today", or — once it has passed — how long ago, in red. */
  const distance = (d: string, pastKey: "daysAgo" | "overdueBy") => {
    const days = daysBetween(preview.on, d);
    if (days === 0) return { hint: tR("today"), late: false };
    if (days > 0) return { hint: tR("inDays", { days }), late: false };
    return { hint: tR(pastKey, { days: -days }), late: true };
  };
  // Only a contract that is running has a deadline worth counting down to.
  const counts = preview.phase !== "draft" && preview.phase !== "cancelled";
  const termEndIn = preview.termEnd && counts ? distance(preview.termEnd, "daysAgo") : null;
  const noticeIn = preview.noticeBy && counts ? distance(preview.noticeBy, "overdueBy") : null;

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(submit, (errors) => {
          // ⚠️ On a phone the field that failed may be on a tab nobody is looking
          // at, and a Save that does nothing visible reads as a broken button.
          const first = Object.keys(errors)[0] as keyof ContractFormValues | undefined;
          if (first) setSection(SECTION_OF[first] ?? "customer");
        })}
        className="flex min-w-0 flex-col gap-4 sm:gap-6"
      >
        <RecordBackLink href="/dashboard/sales/contracts">{t("back")}</RecordBackLink>

        {/* ── Hero: which contract, where it stands, and the dates that decide the next step ── */}
        <RecordHero
          badges={
            saved ? (
              <>
                <StatusBadge tone={PHASE_TONE[saved.phase]}>{t(`phases.${saved.phase}`)}</StatusBadge>
                {initial?.autoRenew && (
                  <StatusBadge>
                    <RefreshCw aria-hidden />
                    {t("autoRenews")}
                  </StatusBadge>
                )}
              </>
            ) : undefined
          }
          title={saved ? initial?.title || t("edit") : t("newContract")}
          meta={
            saved ? (
              <>
                {saved.company && (
                  <MetaItem icon={<Building2 aria-hidden />} href={`/dashboard/companies/${saved.company.id}`}>
                    {saved.company.name}
                  </MetaItem>
                )}
                {saved.contactName && initial?.contactId && (
                  <MetaItem icon={<User aria-hidden />} href={`/dashboard/contacts/${initial.contactId}`}>
                    {saved.contactName}
                  </MetaItem>
                )}
                <MetaItem icon={<UserRound aria-hidden />}>
                  {saved.ownerName ? tR("assignedTo", { name: saved.ownerName }) : tR("unassigned")}
                </MetaItem>
              </>
            ) : (
              <span>{tf("subtitle")}</span>
            )
          }
        >
          <MetricStrip>
            <Metric
              label={t("monthly")}
              hint={t("detail.perYearHint", { amount: formatMoney(preview.monthly * 12, currency) })}
            >
              {formatMoney(preview.monthly, currency)}
            </Metric>
            <Metric label={t("termEnd")} tone={termEndIn?.late ? "danger" : undefined} hint={termEndIn?.hint}>
              {preview.termEnd ? day(preview.termEnd) : tf("noEnd")}
            </Metric>
            {preview.noticeBy && (
              <Metric label={t("noticeBy")} tone={noticeIn?.late ? "danger" : undefined} hint={noticeIn?.hint}>
                {day(preview.noticeBy)}
              </Metric>
            )}
          </MetricStrip>
        </RecordHero>

        {/*
          Two columns from lg: what is being filled in, and the value beside it,
          kept in view while the dates are edited. Below lg both columns dissolve
          (`contents`) so the cards can be ordered by what a phone needs first:
          who, what it is worth, how long it runs, then the notes.
        */}
        {/*
          ⚠️ On a phone the four cards are four tabs. Stacked, the form was some
          2,300px — a scroll past the customer and the value to reach the dates,
          which are what an edit is usually about.
        */}
        <RecordTabBar
          tabs={[
            { id: "customer", label: t("detail.tabCustomer"), icon: <Building2 aria-hidden /> },
            { id: "value", label: t("detail.tabValue"), icon: <Coins aria-hidden /> },
            { id: "term", label: t("detail.tabTerm"), icon: <CalendarRange aria-hidden /> },
            { id: "notes", label: t("detail.tabNotes"), icon: <NotebookPen aria-hidden /> },
          ]}
          active={section}
          onChange={(id) => setSection(id as FormSection)}
          label={tR("sectionsLabel")}
          invalid={[
            ...new Set(Object.keys(form.formState.errors).map((k) => SECTION_OF[k as keyof ContractFormValues])),
          ].filter((v): v is FormSection => !!v)}
        />

        <div className="-mt-3 grid grid-cols-1 items-start gap-4 sm:-mt-4 sm:gap-6 lg:mt-0 lg:grid-cols-12">
          <div className="min-w-0 max-lg:contents lg:col-span-8 lg:flex lg:flex-col lg:gap-6">
            {/* ── Who it is with ── */}
            <Card className={cn("min-w-0 max-lg:order-1", section !== "customer" && "max-lg:hidden")}>
              <CardHeader>
                <CardTitle className="text-base">{tf("customerTitle")}</CardTitle>
                <CardDescription>{tf("customerSubtitle")}</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem className="sm:col-span-2">
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
                    <FormItem className="sm:col-span-2">
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

            {/* ── How long it runs ── */}
            <Card className={cn("min-w-0 max-lg:order-3", section !== "term" && "max-lg:hidden")}>
              <CardHeader>
                <CardTitle className="text-base">{tf("termTitle")}</CardTitle>
                <CardDescription>{tf("termSubtitle")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                    <span className="text-muted-foreground text-xs">{t("status")}</span>
                    <Badge variant="outline">{t(`phases.${preview.phase}`)}</Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground text-xs">{t("termEnd")}</span>
                    <span className="tabular-nums">{preview.termEnd ? day(preview.termEnd) : tf("noEnd")}</span>
                  </div>
                  {preview.noticeBy && (
                    <>
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground text-xs">{t("noticeBy")}</span>
                        <span className="tabular-nums">{day(preview.noticeBy)}</span>
                      </div>
                      <p className="text-muted-foreground text-xs">
                        {tf("asksFrom", { date: preview.asksFrom ? day(preview.asksFrom) : "" })}
                      </p>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* ── Notes: its own card, so the dates above are not a scroll past a paragraph ── */}
            <Card className={cn("min-w-0 max-lg:order-4", section !== "notes" && "max-lg:hidden")}>
              <CardHeader>
                <CardTitle className="text-base">{tf("notes")}</CardTitle>
              </CardHeader>
              <CardContent>
                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Textarea
                          {...field}
                          rows={4}
                          aria-label={tf("notes")}
                          placeholder={tf("notesPlaceholder")}
                          className="resize-y"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>
          </div>

          {/* What it is worth, kept in view while the dates are edited. */}
          <div className="min-w-0 max-lg:contents lg:sticky lg:top-0 lg:col-span-4">
            {/* ── What it is worth ── */}
            <Card className={cn("min-w-0 max-lg:order-2", section !== "value" && "max-lg:hidden")}>
              <CardHeader>
                <CardTitle className="text-base">{tf("valueTitle")}</CardTitle>
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
                            <SelectTrigger className="h-9 w-full">
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
                          <CurrencySelect value={field.value ?? "EUR"} onChange={field.onChange} />
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
                            <SelectTrigger className="h-9 w-full">
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
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-muted-foreground text-xs">{tf("perMonth")}</span>
                    <span className="font-semibold tabular-nums">{formatMoney(preview.monthly, currency)}</span>
                  </div>
                  <div className="mt-1 flex items-baseline justify-between gap-3">
                    <span className="text-muted-foreground text-xs">{tf("perYear")}</span>
                    <span className="tabular-nums">{formatMoney(preview.monthly * 12, currency)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* ── The bar that stays put, at the bottom where the thumb is ── */}
        <EditorFooter
          total={formatMoney(preview.monthly, currency)}
          totalLabel={t("monthly")}
          cancelLabel={t("cancel")}
          saveLabel={t("save")}
          saving={saving}
          onCancel={() => router.push("/dashboard/sales/contracts")}
        />
      </form>
    </Form>
  );
}

/**
 * Save and cancel, stuck to the bottom of the page on every width.
 *
 * ⚠️ `bottom-0` lands above the tab bar, not under it: a sticky box stops at the
 * scroll container's padding, and the layout pads its bottom by exactly the tab
 * bar plus 1rem. The `after:` strip fills that 1rem, which would otherwise show
 * the form scrolling past underneath the buttons.
 */
function EditorFooter({
  total,
  totalLabel,
  cancelLabel,
  saveLabel,
  saving,
  onCancel,
}: {
  total: string;
  totalLabel: string;
  cancelLabel: string;
  saveLabel: string;
  saving: boolean;
  onCancel: () => void;
}) {
  return (
    <div
      data-bottom-bar=""
      className="-mx-4 md:-mx-6 sticky bottom-0 z-20 flex items-center justify-between gap-3 border-t bg-background px-4 py-3 after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-4 after:bg-background md:px-6 md:after:h-6"
    >
      <div className="min-w-0">
        <p className="truncate text-muted-foreground text-xs">{totalLabel}</p>
        <p className="truncate font-bold tabular-nums">{total}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button type="submit" disabled={saving} className="gap-2">
          {saving && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          {saveLabel}
        </Button>
      </div>
    </div>
  );
}
