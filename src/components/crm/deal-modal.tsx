"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import {
  Loader2Icon,
  DollarSignIcon,
  KanbanIcon,
  UserIcon,
  FileTextIcon,
} from "lucide-react";

import { createDeal, updateDeal } from "@/actions/pipeline";
import { getAllUsers } from "@/actions/tasks";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";

// ── Schema ────────────────────────────────────────────────────────────────────
const dealSchema = z.object({
  name:               z.string().min(1, "Name is required"),
  amount:             z.string().optional(),
  currency:           z.string().default("EUR"),
  status:             z.string().default("open"),
  stageId:            z.string().min(1, "Stage is required"),
  probability:        z.coerce.number().min(0).max(100).optional().nullable(),
  expectedCloseDate:  z.string().optional(),
  companyId:          z.string().optional().nullable(),
  contactId:          z.string().optional().nullable(),
  ownerId:            z.string().optional().nullable(),
  notes:              z.string().optional(),
});

type DealFormValues = z.infer<typeof dealSchema>;

const CURRENCIES = [
  { value: "EUR", label: "EUR (€)" },
  { value: "USD", label: "USD ($)" },
  { value: "GBP", label: "GBP (£)" },
];

const DEAL_STATUSES = [
  { value: "open", label: "Open" },
  { value: "won",  label: "Won" },
  { value: "lost", label: "Lost" },
];

// ── Field helper ──────────────────────────────────────────────────────────────
function F({
  label, error, required, children,
}: {
  label: string; error?: string; required?: boolean; children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {label}{required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
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
  deal?: any;
  stages: any[];
  companies?: any[];
  contacts?: any[];
  children?: React.ReactNode;
  onSuccess?: () => void;
}) {
  const [open, setOpen]         = useState(false);
  const [userList, setUserList] = useState<{ id: string; name: string | null }[]>([]);
  const isEditing   = !!deal;
  const searchParams = useSearchParams();

  useEffect(() => {
    if (open) getAllUsers().then(setUserList);
  }, [open]);

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
      name:              deal?.name              || "",
      amount:            deal?.amount            || "",
      currency:          deal?.currency          || "EUR",
      status:            deal?.status            || "open",
      stageId:           deal?.stageId           || (stages.length > 0 ? stages[0].id : ""),
      probability:       deal?.probability       ?? null,
      expectedCloseDate: toDateInput(deal?.expectedCloseDate),
      companyId:         deal?.companyId         || null,
      contactId:         deal?.contactId         || null,
      ownerId:           deal?.ownerId           || null,
      notes:             deal?.notes             || "",
    },
  });

  const { register, control, handleSubmit, formState: { errors, isSubmitting } } = form;
  const e = errors;

  const tabErrors = {
    deal:    !!(e.name || e.amount || e.currency || e.status),
    details: !!(e.stageId || e.probability || e.expectedCloseDate || e.companyId || e.contactId || e.ownerId),
    notes:   !!e.notes,
  };

  const onSubmit = async (data: DealFormValues) => {
    try {
      const payload = {
        ...data,
        expectedCloseDate: data.expectedCloseDate ? new Date(data.expectedCloseDate) : null,
        companyId:  data.companyId  || null,
        contactId:  data.contactId  || null,
        ownerId:    data.ownerId    || null,
      };

      if (isEditing) {
        await updateDeal(deal.id, payload as any);
        toast.success("Deal updated.");
      } else {
        await createDeal(payload as any);
        toast.success("Deal created.");
      }
      setOpen(false);
      if (!isEditing) form.reset();
      onSuccess?.();
    } catch {
      toast.error("Failed to save deal.");
    }
  };

  const TabDot = ({ has }: { has: boolean }) =>
    has ? <span className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-destructive" /> : null;

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) form.reset(); }}>
      <DialogTrigger asChild>
        {children || (
          <Button variant="outline" size="icon" className="h-8 w-8">
            <DollarSignIcon className="h-3.5 w-3.5" />
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="sm:max-w-[640px] max-h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <DialogTitle className="text-lg">
            {isEditing ? `Edit Deal — ${deal.name}` : "New Deal"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <Tabs defaultValue="deal">
              <TabsList className="w-full mb-5">
                <TabsTrigger value="deal" className="relative flex-1 gap-1.5">
                  <DollarSignIcon className="h-3.5 w-3.5" />Deal
                  <TabDot has={tabErrors.deal} />
                </TabsTrigger>
                <TabsTrigger value="details" className="relative flex-1 gap-1.5">
                  <KanbanIcon className="h-3.5 w-3.5" />Pipeline
                  <TabDot has={tabErrors.details} />
                </TabsTrigger>
                <TabsTrigger value="notes" className="relative flex-1 gap-1.5">
                  <FileTextIcon className="h-3.5 w-3.5" />Notes
                  <TabDot has={tabErrors.notes} />
                </TabsTrigger>
              </TabsList>

              {/* ── Deal Tab ──────────────────────────────────────────────── */}
              <TabsContent value="deal" className="grid grid-cols-2 gap-x-4 gap-y-4 mt-0">
                <div className="col-span-2">
                  <F label="Deal Name" required error={e.name?.message}>
                    <Input {...register("name")} placeholder="e.g. Q1 Software License" />
                  </F>
                </div>
                <F label="Amount" error={e.amount?.message}>
                  <Input {...register("amount")} type="number" placeholder="0.00" min={0} step="0.01" />
                </F>
                <F label="Currency" error={e.currency?.message}>
                  <Controller control={control} name="currency" render={({ field }) => (
                    <Select onValueChange={field.onChange} value={field.value}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {CURRENCIES.map((c) => (
                          <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )} />
                </F>
                <div className="col-span-2">
                  <F label="Status" error={e.status?.message}>
                    <div className="grid grid-cols-3 gap-2">
                      <Controller control={control} name="status" render={({ field }) => (
                        <>
                          {DEAL_STATUSES.map((s) => (
                            <button
                              key={s.value}
                              type="button"
                              onClick={() => field.onChange(s.value)}
                              className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-all ${
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
                      )} />
                    </div>
                  </F>
                </div>
              </TabsContent>

              {/* ── Pipeline Tab ──────────────────────────────────────────── */}
              <TabsContent value="details" className="grid grid-cols-2 gap-x-4 gap-y-4 mt-0">
                <div className="col-span-2">
                  <F label="Stage" required error={e.stageId?.message}>
                    <Controller control={control} name="stageId" render={({ field }) => (
                      <Select onValueChange={field.onChange} value={field.value}>
                        <SelectTrigger><SelectValue placeholder="Select stage" /></SelectTrigger>
                        <SelectContent>
                          {stages.map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              <div className="flex items-center gap-2">
                                <span className="h-2 w-2 rounded-full shrink-0" style={{ background: s.color ?? "#94a3b8" }} />
                                {s.name}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )} />
                  </F>
                </div>
                <F label="Probability (%)" error={e.probability?.message}>
                  <Input {...register("probability")} type="number" placeholder="0" min={0} max={100} />
                </F>
                <F label="Expected Close Date" error={e.expectedCloseDate?.message}>
                  <Input {...register("expectedCloseDate")} type="date" />
                </F>
                <div className="col-span-2">
                  <F label="Assigned To" error={e.ownerId?.message}>
                    <Controller control={control} name="ownerId" render={({ field }) => (
                      <Select onValueChange={(v) => field.onChange(v === "__none__" ? null : v)} value={field.value ?? "__none__"}>
                        <SelectTrigger><SelectValue placeholder="— Unassigned —" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">— Unassigned —</SelectItem>
                          {userList.map((u) => (
                            <SelectItem key={u.id} value={u.id}>{u.name ?? u.id}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )} />
                  </F>
                </div>
                <F label="Company" error={e.companyId?.message}>
                  <Controller control={control} name="companyId" render={({ field }) => (
                    <Select onValueChange={(v) => field.onChange(v === "__none__" ? null : v)} value={field.value ?? "__none__"}>
                      <SelectTrigger><SelectValue placeholder="— None —" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— None —</SelectItem>
                        {companies?.map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )} />
                </F>
                <F label="Contact" error={e.contactId?.message}>
                  <Controller control={control} name="contactId" render={({ field }) => (
                    <Select onValueChange={(v) => field.onChange(v === "__none__" ? null : v)} value={field.value ?? "__none__"}>
                      <SelectTrigger><SelectValue placeholder="— None —" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— None —</SelectItem>
                        {contacts?.map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.firstName} {c.lastName}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )} />
                </F>
              </TabsContent>

              {/* ── Notes Tab ─────────────────────────────────────────────── */}
              <TabsContent value="notes" className="mt-0">
                <F label="Notes" error={e.notes?.message}>
                  <Textarea
                    {...register("notes")}
                    placeholder="Internal notes about this deal…"
                    className="min-h-[180px] resize-y"
                  />
                </F>
              </TabsContent>
            </Tabs>
          </div>

          <DialogFooter className="px-6 py-4 border-t bg-muted/30">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting} className="min-w-[110px]">
              {isSubmitting && <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />}
              {isEditing ? "Save Changes" : "Create Deal"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
