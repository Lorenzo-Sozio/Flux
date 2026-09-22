"use client";

import { useEffect, useState } from "react";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Tags } from "lucide-react";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { createPriceList, updatePriceList } from "@/actions/price-lists";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { MAX_ADJUSTMENT, MIN_ADJUSTMENT } from "@/lib/price-list";

/** The fields of a list this form owns — the counts around it are somebody else's. */
export interface PriceListFields {
  id: string;
  name: string;
  description: string | null;
  adjustmentPercent: string;
  isActive: boolean;
}

// ⚠️ The same message keys the server action's schema uses
// (`validation.priceLists.*`), so a rule tightened on one side is never
// described differently on the other.
const formSchema = z.object({
  name: z.string().trim().min(1, "nameRequired"),
  description: z.string().optional(),
  adjustmentPercent: z.coerce.number().min(MIN_ADJUSTMENT, "adjustmentRange").max(MAX_ADJUSTMENT, "adjustmentRange"),
  isActive: z.boolean().default(true),
});
type FormValues = z.infer<typeof formSchema>;

/**
 * Creating a list and editing one, from the catalogue screen and from the list's
 * own page. One form: the percentage is the whole point of the record, and two
 * copies of it would be two places for the bounds to drift.
 */
export function PriceListDialog({
  open,
  onOpenChange,
  priceList,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  priceList?: PriceListFields;
  onSaved: (row: PriceListFields) => void;
}) {
  const t = useTranslations("priceLists");
  const tv = useTranslations("validation.priceLists");
  const [submitting, setSubmitting] = useState(false);
  const isEdit = !!priceList;

  const defaults = (): FormValues => ({
    name: priceList?.name ?? "",
    description: priceList?.description ?? "",
    adjustmentPercent: priceList ? Number(priceList.adjustmentPercent) : 0,
    isActive: priceList?.isActive ?? true,
  });

  const form = useForm<FormValues>({ resolver: zodResolver(formSchema), defaultValues: defaults() });

  // The record being edited is the trigger. `form` is a new object on every
  // render, so depending on it would reset the fields under the hands of whoever
  // is typing in them.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the record is the trigger
  useEffect(() => {
    form.reset(defaults());
  }, [priceList]);

  const onSubmit = async (data: FormValues) => {
    setSubmitting(true);
    try {
      const saved = isEdit ? await updatePriceList(priceList.id, data) : await createPriceList(data);
      onSaved(saved as PriceListFields);
      toast.success(isEdit ? t("updateSuccess") : t("createSuccess"));
      onOpenChange(false);
      form.reset();
    } catch {
      toast.error(isEdit ? t("updateFailed") : t("createFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!submitting) {
          onOpenChange(v);
          if (!v) form.reset();
        }
      }}
    >
      <DialogContent className="gap-0 p-0 sm:max-w-[480px]">
        <DialogHeader className="border-b px-4 pt-6 pb-4 md:px-6">
          <DialogTitle className="flex items-center gap-2">
            <Tags className="h-4.5 w-4.5 text-primary" />
            {isEdit ? t("dialog.editTitle") : t("dialog.newTitle")}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)}>
          <div className="space-y-4 px-4 py-5 md:px-6">
            <div className="space-y-1.5">
              <Label>
                {t("dialog.nameLabel")} <span className="text-destructive">*</span>
              </Label>
              <Input {...form.register("name")} placeholder={t("form.namePlaceholder")} />
              {form.formState.errors.name && <p className="text-destructive text-xs">{tv("nameRequired")}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>
                {t("dialog.adjustmentLabel")} <span className="text-destructive">*</span>
              </Label>
              <Input
                type="number"
                step="0.01"
                min={MIN_ADJUSTMENT}
                max={MAX_ADJUSTMENT}
                {...form.register("adjustmentPercent")}
                placeholder="0"
              />
              <p className="text-muted-foreground text-xs">{t("dialog.adjustmentHelp")}</p>
              {form.formState.errors.adjustmentPercent && (
                <p className="text-destructive text-xs">{tv("adjustmentRange")}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>
                {t("dialog.descriptionLabel")}{" "}
                <span className="font-normal text-muted-foreground">{t("dialog.optional")}</span>
              </Label>
              <Textarea
                {...form.register("description")}
                placeholder={t("form.descriptionPlaceholder")}
                className="min-h-[72px] resize-none"
              />
            </div>

            <div className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3">
              <div className="min-w-0">
                <p className="font-medium text-sm">{t("dialog.activeLabel")}</p>
                <p className="text-muted-foreground text-xs">{t("dialog.activeDesc")}</p>
              </div>
              <Switch checked={form.watch("isActive")} onCheckedChange={(v) => form.setValue("isActive", v)} />
            </div>
          </div>

          <DialogFooter className="border-t bg-muted/10 px-4 py-4 md:px-6">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={submitting} className="gap-2">
              {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {isEdit ? t("dialog.saveChanges") : t("dialog.createPriceList")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
