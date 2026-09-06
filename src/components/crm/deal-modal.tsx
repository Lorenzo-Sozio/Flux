"use client";

import { useEffect, useState } from "react";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowUpRightIcon, DollarSignIcon, FileTextIcon, KanbanIcon, Loader2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { createDeal, updateDeal } from "@/actions/pipeline";
import { AssigneeSelect, decodeAssignee, encodeAssignee } from "@/components/crm/assignee-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { deals } from "@/db/schema";

// ── Schema ────────────────────────────────────────────────────────────────────
const dealSchema = z.object({
  name: z.string().min(1, "Name is required"),
  amount: z.string().optional(),
  currency: z.string().default("EUR"),
  status: z.string().default("open"),
  stageId: z.string().min(1, "Stage is required"),
  probability: z.coerce.number().min(0).max(100).optional().nullable(),
  expectedCloseDate: z.string().optional(),
  companyId: z.string().optional().nullable(),
  contactId: z.string().optional().nullable(),
  ownerId: z.string().optional().nullable(),
  groupId: z.string().optional().nullable(),
  assigneeValue: z.string().optional(),
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
  stages: { id: string; name: string; color?: string | null; defaultProbability?: number | null }[];
  // Only what the two selects draw. `any[]` here meant a typo in either list
  // compiled fine and produced empty options at runtime.
  companies?: { id: string; name: string }[];
  contacts?: { id: string; firstName: string | null; lastName: string | null }[];
  children?: React.ReactNode;
  onSuccess?: () => void;
}) {
  const t = useTranslations("pipeline");
  const [open, setOpen] = useState(false);
  const isEditing = !!deal;
  const searchParams = useSearchParams();

  const DEAL_STATUSES = [
    { value: "open", label: t("modal.statusOpen") },
    { value: "won", label: t("modal.statusWon") },
    { value: "lost", label: t("modal.statusLost") },
  ];

  useEffect(() => {
    if (!isEditing && searchParams?.get("new") === "true") setOpen(true);
  }, [isEditing, searchParams]);

  const toDateInput = (val: Date | string | null | undefined) => {
    if (!val) return "";
    const d = new Date(val);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString().split("T")[0];
  };

  const form = useForm<DealFormValues>({
    resolver: zodResolver(dealSchema),
    defaultValues: {
      name: deal?.name || "",
      amount: deal?.amount || "",
      currency: deal?.currency || "EUR",
      status: deal?.status || "open",
      stageId: deal?.stageId || (stages.length > 0 ? stages[0].id : ""),
      probability: deal?.probability ?? null,
      expectedCloseDate: toDateInput(deal?.expectedCloseDate),
      companyId: deal?.companyId || null,
      contactId: deal?.contactId || null,
      ownerId: deal?.ownerId || null,
      groupId: deal?.groupId || null,
      assigneeValue: encodeAssignee(deal?.ownerId, deal?.groupId),
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

  const tabErrors = {
    deal: !!(e.name || e.amount || e.currency || e.status),
    details: !!(e.stageId || e.probability || e.expectedCloseDate || e.companyId || e.contactId),
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

      <DialogContent className="flex flex-col gap-0 p-0 sm:max-w-[640px]">
        <DialogHeader className="border-b px-4 md:px-6 pt-6 pb-4">
          <div className="flex items-center justify-between gap-2">
            <DialogTitle className="text-lg">
              {isEditing ? t("modal.editTitle", { name: deal.name ?? "" }) : t("modal.newTitle")}
            </DialogTitle>
            {isEditing && deal && (
              <Link href={`/dashboard/pipeline/${deal.id}`} onClick={() => setOpen(false)}>
                <Button
                  variant="ghost"
                  size="icon"
                  type="button"
                  title="Apri scheda completa"
                  className="h-8 w-8 shrink-0"
                >
                  <ArrowUpRightIcon className="h-4 w-4" />
                </Button>
              </Link>
            )}
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4">
            <Tabs defaultValue="deal">
              <TabsList className="mb-5 w-full">
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

              {/* ── Deal Tab ──────────────────────────────────────────────── */}
              <TabsContent value="deal" className="mt-0 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-4">
                <div className="col-span-1 sm:col-span-2">
                  <F label={t("modal.fieldDealName")} required error={e.name?.message}>
                    <Input {...register("name")} placeholder={t("modal.namePlaceholder")} />
                  </F>
                </div>
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
                <div className="col-span-1 sm:col-span-2">
                  <F label={t("modal.fieldStatus")} error={e.status?.message}>
                    <div className="grid grid-cols-3 gap-2">
                      <Controller
                        control={control}
                        name="status"
                        render={({ field }) => (
                          <>
                            {DEAL_STATUSES.map((s) => (
                              <button
                                key={s.value}
                                type="button"
                                onClick={() => field.onChange(s.value)}
                                className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 font-medium text-sm transition-all ${
                                  field.value === s.value
                                    ? s.value === "won"
                                      ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400"
                                      : s.value === "lost"
                                        ? "border-red-500 bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400"
                                        : "border-primary bg-primary/10 text-primary"
                                    : "border-border bg-background hover:bg-accent"
                                }`}
                              >
                                {s.label}
                              </button>
                            ))}
                          </>
                        )}
                      />
                    </div>
                  </F>
                </div>
              </TabsContent>

              {/* ── Pipeline Tab ──────────────────────────────────────────── */}
              <TabsContent value="details" className="mt-0 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-4">
                <div className="col-span-1 sm:col-span-2">
                  <F label={t("modal.fieldStageLabel")} required error={e.stageId?.message}>
                    <Controller
                      control={control}
                      name="stageId"
                      render={({ field }) => (
                        <Select onValueChange={field.onChange} value={field.value}>
                          <SelectTrigger>
                            <SelectValue placeholder={t("form.selectStage")} />
                          </SelectTrigger>
                          <SelectContent>
                            {stages.map((s) => (
                              <SelectItem key={s.id} value={s.id}>
                                <div className="flex items-center gap-2">
                                  <span
                                    className="h-2 w-2 shrink-0 rounded-full"
                                    style={{ background: s.color ?? "#94a3b8" }}
                                  />
                                  {s.name}
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </F>
                </div>
                <F label={t("modal.fieldProbability")} error={e.probability?.message}>
                  <Input {...register("probability")} type="number" placeholder="0" min={0} max={100} />
                </F>
                <F label={t("modal.fieldExpectedClose")} error={e.expectedCloseDate?.message}>
                  <Input {...register("expectedCloseDate")} type="date" />
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
                <F label={t("modal.fieldCompany")} error={e.companyId?.message}>
                  <Controller
                    control={control}
                    name="companyId"
                    render={({ field }) => (
                      <Select
                        onValueChange={(v) => field.onChange(v === "__none__" ? null : v)}
                        value={field.value ?? "__none__"}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={t("modal.noneOption")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">{t("modal.noneOption")}</SelectItem>
                          {companies?.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </F>
                <F label={t("modal.fieldContact")} error={e.contactId?.message}>
                  <Controller
                    control={control}
                    name="contactId"
                    render={({ field }) => (
                      <Select
                        onValueChange={(v) => field.onChange(v === "__none__" ? null : v)}
                        value={field.value ?? "__none__"}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={t("modal.noneOption")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">{t("modal.noneOption")}</SelectItem>
                          {contacts?.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.firstName} {c.lastName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </F>
              </TabsContent>

              {/* ── Notes Tab ─────────────────────────────────────────────── */}
              <TabsContent value="notes" className="mt-0">
                <F label={t("modal.fieldNotes")} error={e.notes?.message}>
                  <Textarea
                    {...register("notes")}
                    placeholder={t("modal.notesPlaceholder")}
                    className="min-h-[180px] resize-y"
                  />
                </F>
              </TabsContent>
            </Tabs>
          </div>

          <DialogFooter className="border-t bg-muted/30 px-4 md:px-6 py-4">
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
