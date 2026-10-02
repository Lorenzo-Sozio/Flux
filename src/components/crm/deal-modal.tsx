"use client";

import { useEffect, useMemo, useState } from "react";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowUpRightIcon, DollarSignIcon, FileTextIcon, KanbanIcon, Loader2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { getCompaniesForSelect, getContactsForSelect } from "@/actions/crm";
import { createDeal, updateDeal } from "@/actions/pipeline";
import { AssigneeSelect, decodeAssignee, encodeAssignee } from "@/components/crm/assignee-select";
import { SourceSelect } from "@/components/crm/source-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { deals } from "@/db/schema";
import { dealAmountForEditing } from "@/lib/deal-amount";

// ── Schema ────────────────────────────────────────────────────────────────────
const dealSchema = z.object({
  name: z.string().min(1, "Name is required"),
  amount: z.string().optional(),
  currency: z.string().default("EUR"),
  stageId: z.string().min(1, "Stage is required"),
  probability: z.coerce.number().min(0).max(100).optional().nullable(),
  expectedCloseDate: z.string().optional(),
  companyId: z.string().optional().nullable(),
  contactId: z.string().optional().nullable(),
  ownerId: z.string().optional().nullable(),
  groupId: z.string().optional().nullable(),
  assigneeValue: z.string().optional(),
  source: z.string().optional(),
  notes: z.string().optional(),
});

type DealFormValues = z.infer<typeof dealSchema>;

const CURRENCIES = [
  { value: "EUR", label: "EUR (€)" },
  { value: "USD", label: "USD ($)" },
  { value: "GBP", label: "GBP (£)" },
];

// ── Field helper ──────────────────────────────────────────────────────────────
function F({
  label,
  error,
  required,
  children,
}: {
  label: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {children}
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  );
}

type DealContactOption = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email?: string | null;
  companyId?: string | null;
};

// ── Main Component ────────────────────────────────────────────────────────────
export function DealModal({
  deal,
  stages,
  companies,
  contacts,
  children,
  onSuccess,
}: {
  // The row as the board holds it. Partial because the modal is also the create
  // form, where there is no row yet.
  deal?: Partial<typeof deals.$inferSelect> & { id: string };
  stages: {
    id: string;
    name: string;
    color?: string | null;
    defaultProbability?: number | null;
    isWon?: boolean | null;
    isLost?: boolean | null;
    /** Set when there is more than one pipeline: whose stage this is. */
    pipelineName?: string | null;
  }[];
  // Only what the two selects draw. `any[]` here meant a typo in either list
  // compiled fine and produced empty options at runtime.
  // ⚠️ Usually left out: the dialog asks for them when it opens. Every company and every contact
  // of the workspace used to travel with each visit to the board and to every deal, for a
  // dialog most visits never open.
  companies?: { id: string; name: string }[];
  contacts?: DealContactOption[];
  children?: React.ReactNode;
  onSuccess?: () => void;
}) {
  const t = useTranslations("pipeline");
  const [open, setOpen] = useState(false);
  const isEditing = !!deal;
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!isEditing && searchParams?.get("new") === "true") setOpen(true);
  }, [isEditing, searchParams]);

  // The two lists, asked for the first time the dialog opens when the page did not hand them over.
  const [fetched, setFetched] = useState<{
    companies: { id: string; name: string }[];
    contacts: DealContactOption[];
  } | null>(null);
  useEffect(() => {
    if (!open || fetched || (companies && contacts)) return;
    let alive = true;
    Promise.all([getCompaniesForSelect(), getContactsForSelect()])
      .then(([companyRows, contactRows]) => {
        if (alive) setFetched({ companies: companyRows, contacts: contactRows });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [open, fetched, companies, contacts]);
  const companyOptions = companies ?? fetched?.companies ?? [];
  const contactOptions = contacts ?? fetched?.contacts ?? [];

  const toDateInput = (val: Date | string | null | undefined) => {
    if (!val) return "";
    const d = new Date(val);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString().split("T")[0];
  };

  const form = useForm<DealFormValues>({
    resolver: zodResolver(dealSchema),
    defaultValues: {
      name: deal?.name || "",
      // The figure as typed and its currency, never the EUR figure beside the deal's own
      // currency: saving that converted it again. See src/lib/deal-amount.ts.
      ...(deal
        ? dealAmountForEditing({
            amount: deal.amount ?? null,
            amountOriginal: deal.amountOriginal,
            currency: deal.currency ?? null,
          })
        : { amount: "", currency: "EUR" }),
      stageId: deal?.stageId || (stages.length > 0 ? stages[0].id : ""),
      probability: deal?.probability ?? null,
      expectedCloseDate: toDateInput(deal?.expectedCloseDate),
      companyId: deal?.companyId || null,
      contactId: deal?.contactId || null,
      ownerId: deal?.ownerId || null,
      groupId: deal?.groupId || null,
      assigneeValue: encodeAssignee(deal?.ownerId, deal?.groupId),
      source: deal?.source || "",
      notes: deal?.notes || "",
    },
  });

  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = form;
  const e = errors;

  // The pickers the quote, order and contract forms use: searchable, the contact narrowed to the
  // chosen company. A deal may have neither, so each list opens on "none".
  const companyId = form.watch("companyId");
  const companyName = useMemo(() => new Map(companyOptions.map((c) => [c.id, c.name])), [companyOptions]);
  const companyChoices = useMemo(
    () => [{ value: "", label: t("modal.noCompany") }, ...companyOptions.map((c) => ({ value: c.id, label: c.name }))],
    [companyOptions, t],
  );
  const contactChoices = useMemo(() => {
    const scoped = companyId ? contactOptions.filter((c) => c.companyId === companyId) : contactOptions;
    return [
      { value: "", label: t("modal.noContact") },
      ...scoped.map((c) => ({
        value: c.id,
        label: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || c.id,
        // Who they work for when every contact is listed; their address when only one company's are.
        sublabel: (companyId ? c.email : c.companyId ? companyName.get(c.companyId) : c.email) ?? undefined,
      })),
    ];
  }, [contactOptions, companyId, companyName, t]);

  const tabErrors = {
    deal: !!(e.name || e.amount || e.currency || e.companyId || e.contactId),
    details: !!(e.stageId || e.probability || e.expectedCloseDate),
    notes: !!e.notes,
  };

  const onSubmit = async (data: DealFormValues) => {
    try {
      const { ownerId, groupId } = decodeAssignee(data.assigneeValue);
      const payload = {
        ...data,
        expectedCloseDate: data.expectedCloseDate ? new Date(data.expectedCloseDate) : null,
        companyId: data.companyId || null,
        contactId: data.contactId || null,
        ownerId,
        groupId,
        assigneeValue: undefined,
        // Left alone when nobody picked one: the form cannot clear a source, only change it.
        source: data.source || undefined,
      };

      if (isEditing) {
        await updateDeal(deal.id, payload as Partial<typeof deals.$inferInsert>);
        toast.success(t("updateSuccess"));
      } else {
        await createDeal(payload as Partial<typeof deals.$inferInsert>);
        toast.success(t("createSuccess"));
      }
      setOpen(false);
      if (!isEditing) form.reset();
      onSuccess?.();
    } catch {
      toast.error(t("modal.saveError"));
    }
  };

  const TabDot = ({ has }: { has: boolean }) =>
    has ? <span className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-destructive" /> : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) form.reset();
      }}
    >
      <DialogTrigger asChild>
        {children || (
          <Button variant="outline" size="icon" className="h-8 w-8">
            <DollarSignIcon className="h-3.5 w-3.5" />
          </Button>
        )}
      </DialogTrigger>

      {/* ⚠️ A fixed height from sm up: the tabs hold different amounts, and a dialog that took each
          one's height moved its own tab bar under the pointer at every switch. Header, tab bar and
          footer stay put; only the fields scroll. Below sm the dialog is the whole screen anyway. */}
      <DialogContent className="flex flex-col gap-0 p-0 sm:h-[min(580px,calc(100dvh-4rem))] sm:max-w-[640px]">
        {/* ⚠️ `pr-12`: the dialog's own close button is absolutely placed in this
            corner, and the "open full record" button used to sit right under it —
            two targets in one spot, and on a phone the one you hit is a guess. */}
        <DialogHeader className="shrink-0 border-b px-4 pt-6 pr-12 pb-4 md:px-6 md:pr-12">
          <div className="flex items-center justify-between gap-2">
            <DialogTitle className="min-w-0 break-words text-lg">
              {isEditing ? t("modal.editTitle", { name: deal.name ?? "" }) : t("modal.newTitle")}
            </DialogTitle>
            {isEditing && deal && (
              <Link href={`/dashboard/pipeline/${deal.id}`} onClick={() => setOpen(false)}>
                <Button
                  variant="ghost"
                  size="icon"
                  type="button"
                  title={t("dealModal.openFullRecord")}
                  aria-label={t("dealModal.openFullRecord")}
                  className="h-8 w-8 shrink-0 max-md:size-9"
                >
                  <ArrowUpRightIcon className="h-4 w-4" />
                </Button>
              </Link>
            )}
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
          <Tabs defaultValue="deal" className="flex min-h-0 flex-1 flex-col gap-0">
            <div className="shrink-0 px-4 pt-4 md:px-6">
              <TabsList className="w-full">
                <TabsTrigger value="deal" className="relative flex-1 gap-1.5">
                  <DollarSignIcon className="h-3.5 w-3.5" />
                  {t("modal.tabDeal")}
                  <TabDot has={tabErrors.deal} />
                </TabsTrigger>
                <TabsTrigger value="details" className="relative flex-1 gap-1.5">
                  <KanbanIcon className="h-3.5 w-3.5" />
                  {t("modal.tabPipeline")}
                  <TabDot has={tabErrors.details} />
                </TabsTrigger>
                <TabsTrigger value="notes" className="relative flex-1 gap-1.5">
                  <FileTextIcon className="h-3.5 w-3.5" />
                  {t("modal.tabNotes")}
                  <TabDot has={tabErrors.notes} />
                </TabsTrigger>
              </TabsList>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-6">
              {/* ── Deal: what it is and who it is for ───────────────────── */}
              <TabsContent value="deal" className="mt-0 grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
                <div className="col-span-1 sm:col-span-2">
                  <F label={t("modal.fieldDealName")} required error={e.name ? t("dealModal.nameRequired") : undefined}>
                    <Input {...register("name")} placeholder={t("modal.namePlaceholder")} />
                  </F>
                </div>
                <F label={t("modal.fieldCompany")} error={e.companyId?.message}>
                  <Controller
                    control={control}
                    name="companyId"
                    render={({ field }) => (
                      <SearchableSelect
                        options={companyChoices}
                        value={field.value ?? ""}
                        onChange={(v) => {
                          field.onChange(v || null);
                          // A contact from the previous company is worse than none.
                          const contact = contactOptions.find((c) => c.id === form.getValues("contactId"));
                          if (v && contact && contact.companyId !== v) form.setValue("contactId", null);
                        }}
                        placeholder={t("modal.companyPlaceholder")}
                        searchPlaceholder={t("modal.searchPlaceholder")}
                        emptyText={t("modal.companyEmpty")}
                      />
                    )}
                  />
                </F>
                <F label={t("modal.fieldContact")} error={e.contactId?.message}>
                  <Controller
                    control={control}
                    name="contactId"
                    render={({ field }) => (
                      <SearchableSelect
                        options={contactChoices}
                        value={field.value ?? ""}
                        onChange={(v) => {
                          field.onChange(v || null);
                          // Picked first, the person brings their company along.
                          const contact = contactOptions.find((c) => c.id === v);
                          if (contact?.companyId && !form.getValues("companyId"))
                            form.setValue("companyId", contact.companyId);
                        }}
                        placeholder={t("modal.contactPlaceholder")}
                        searchPlaceholder={t("modal.searchPlaceholder")}
                        emptyText={companyId ? t("modal.contactEmptyAtCompany") : t("modal.contactEmpty")}
                      />
                    )}
                  />
                </F>
                <F label={t("modal.fieldAmount")} error={e.amount?.message}>
                  <Input {...register("amount")} type="number" placeholder="0.00" min={0} step="0.01" />
                </F>
                <F label={t("modal.fieldCurrency")} error={e.currency?.message}>
                  <Controller
                    control={control}
                    name="currency"
                    render={({ field }) => (
                      <Select onValueChange={field.onChange} value={field.value}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CURRENCIES.map((c) => (
                            <SelectItem key={c.value} value={c.value}>
                              {c.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </F>
              </TabsContent>

              {/* ── Pipeline: where it stands and whose it is ─────────────── */}
              <TabsContent value="details" className="mt-0 grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
                <div className="col-span-1 sm:col-span-2">
                  <F
                    label={t("modal.fieldStageLabel")}
                    required
                    error={e.stageId ? t("dealModal.stageRequired") : undefined}
                  >
                    <Controller
                      control={control}
                      name="stageId"
                      render={({ field }) => (
                        <Select onValueChange={field.onChange} value={field.value}>
                          <SelectTrigger>
                            <SelectValue placeholder={t("form.selectStage")} />
                          </SelectTrigger>
                          <SelectContent>
                            {/* ⚠️ Open stages only (and the one the deal is in). Closing is the
                                Won / Lost action, which moves stage and status together and asks
                                why a deal was lost; a status field beside this select let the two
                                disagree, and a lost column picked here would have skipped the
                                reason. */}
                            {stages
                              .filter((s) => (!s.isWon && !s.isLost) || s.id === deal?.stageId)
                              .map((s) => (
                                <SelectItem key={s.id} value={s.id}>
                                  <div className="flex items-center gap-2">
                                    <span
                                      className="h-2 w-2 shrink-0 rounded-full"
                                      style={{ background: s.color ?? "#94a3b8" }}
                                    />
                                    {s.pipelineName ? `${s.pipelineName} · ${s.name}` : s.name}
                                  </div>
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </F>
                </div>
                <F
                  label={t("modal.fieldProbability")}
                  error={e.probability ? t("dealModal.probabilityRange") : undefined}
                >
                  <Input {...register("probability")} type="number" placeholder="0" min={0} max={100} />
                </F>
                <F label={t("modal.fieldExpectedClose")} error={e.expectedCloseDate?.message}>
                  <Input {...register("expectedCloseDate")} type="date" />
                </F>
                {/* Where the customer came from: the lead's, copied on conversion (src/lib/record-sources.ts). */}
                <F label={t("modal.fieldSource")}>
                  <Controller
                    control={control}
                    name="source"
                    render={({ field }) => (
                      <SourceSelect
                        value={field.value}
                        onChange={field.onChange}
                        placeholder={t("modal.selectSource")}
                      />
                    )}
                  />
                </F>
                <div className="col-span-1 sm:col-span-2">
                  <F label={t("modal.fieldAssignedTo")}>
                    <Controller
                      control={control}
                      name="assigneeValue"
                      render={({ field }) => <AssigneeSelect value={field.value ?? null} onChange={field.onChange} />}
                    />
                  </F>
                </div>
              </TabsContent>

              {/* ── Notes ──────────────────────────────────────────────────── */}
              {/* The text box takes whatever height the panel has left, rather than a height of its
                  own: a fixed one plus the label ran past the panel and scrolled an empty note. */}
              <TabsContent value="notes" className="mt-0 flex h-full flex-col gap-1.5">
                <Label
                  htmlFor="deal-notes"
                  className="font-medium text-muted-foreground text-xs uppercase tracking-wide"
                >
                  {t("modal.fieldNotes")}
                </Label>
                <Textarea
                  id="deal-notes"
                  {...register("notes")}
                  placeholder={t("modal.notesPlaceholder")}
                  className="field-sizing-fixed min-h-[160px] flex-1 resize-none"
                />
                {e.notes?.message && <p className="text-destructive text-xs">{e.notes.message}</p>}
              </TabsContent>
            </div>
          </Tabs>

          <DialogFooter className="shrink-0 border-t bg-muted/30 px-4 py-4 md:px-6">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t("modal.cancel")}
            </Button>
            <Button type="submit" disabled={isSubmitting} className="min-w-[110px]">
              {isSubmitting && <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />}
              {isEditing ? t("modal.saveChanges") : t("modal.createDeal")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
