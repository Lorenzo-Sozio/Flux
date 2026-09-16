"use client";

import { useState } from "react";

import Link from "next/link";

import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, ExternalLink, FileText, Loader2, MailIcon, Pencil, Plus, TargetIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { createMarketingCampaign, updateMarketingCampaign } from "@/actions/marketing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useOpenOnNew } from "@/hooks/use-open-on-new";

// ── Schema ─────────────────────────────────────────────────────────────────────
const campaignSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  status: z.enum(["draft", "active", "completed"]).default("draft"),
  templateId: z.string().optional().nullable(),
});
type FormValues = z.infer<typeof campaignSchema>;

// ── Types ──────────────────────────────────────────────────────────────────────
interface Template {
  id: string;
  name: string;
  subject: string;
  category: string;
}

interface CampaignModalProps {
  /** Open when the page is reached with ?new=true. One per page. */
  openOnNew?: boolean;
  templates: Template[];
  campaign?: {
    id: string;
    name: string;
    description?: string;
    status: string;
    templateId?: string;
  };
  onSuccess?: () => void;
  children?: React.ReactNode;
}

// ── Constants ──────────────────────────────────────────────────────────────────
/** Labels live under marketing.templateCategories.<key>. */
const CATEGORY_CONFIG: Record<string, { className: string }> = {
  general: { className: "border-slate-300 text-slate-600" },
  welcome: { className: "border-green-300 text-green-700 bg-green-50" },
  followup: { className: "border-blue-300 text-blue-700 bg-blue-50" },
  promotional: { className: "border-violet-300 text-violet-700 bg-violet-50" },
  transactional: { className: "border-amber-300 text-amber-700 bg-amber-50" },
};

/** Label: marketing.campaigns.statuses.<value>; description: marketing.campaignModal.statusDesc.<value>. */
const STATUS_OPTIONS = ["draft", "active", "completed"] as const;

// ── Field helper ───────────────────────────────────────────────────────────────
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

// ── Main Component ─────────────────────────────────────────────────────────────
export function CampaignModal({ templates, campaign, onSuccess, children, openOnNew = false }: CampaignModalProps) {
  const t = useTranslations("marketing.campaignModal");
  const tm = useTranslations("marketing");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  useOpenOnNew(openOnNew && !campaign, setOpen);
  const isEditing = !!campaign;

  const form = useForm<FormValues>({
    resolver: zodResolver(campaignSchema),
    defaultValues: {
      name: campaign?.name ?? "",
      description: campaign?.description ?? "",
      status: (campaign?.status as FormValues["status"]) ?? "draft",
      templateId: campaign?.templateId ?? null,
    },
  });

  const {
    register,
    control,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = form;
  const e = errors;

  const selectedTemplateId = watch("templateId");
  const selectedTemplate = templates.find((tpl) => tpl.id === selectedTemplateId);

  const tabErrors = {
    details: !!(e.name || e.description || e.status),
    template: !!e.templateId,
  };

  async function onSubmit(data: FormValues) {
    try {
      const payload = { ...data, templateId: data.templateId || null };
      if (isEditing) {
        await updateMarketingCampaign(campaign.id, payload);
        toast.success(t("updated"));
      } else {
        await createMarketingCampaign(payload);
        toast.success(t("created"));
      }
      setOpen(false);
      form.reset();
      onSuccess?.();
    } catch {
      toast.error(t("saveFailed"));
    }
  }

  const TabDot = ({ has }: { has: boolean }) =>
    has ? <span className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-destructive" /> : null;

  const trigger = children ?? (
    <Button
      variant={isEditing ? "ghost" : "default"}
      size={isEditing ? "icon" : "default"}
      className={isEditing ? "h-8 w-8" : "gap-2"}
    >
      {isEditing ? (
        <Pencil className="h-3.5 w-3.5" />
      ) : (
        <>
          <Plus className="h-4 w-4" />
          {tm("campaigns.newCampaign")}
        </>
      )}
    </Button>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) form.reset();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>

      <DialogContent className="flex flex-col gap-0 p-0 sm:max-w-[620px]">
        {/* Header */}
        <DialogHeader className="border-b px-4 md:px-6 pt-6 pb-4">
          <DialogTitle className="flex items-center gap-2.5 text-lg">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <TargetIcon className="h-4 w-4 text-primary" />
            </div>
            {isEditing ? t("editTitle", { name: campaign.name }) : tm("campaigns.newCampaign")}
          </DialogTitle>
        </DialogHeader>

        {/* Body */}
        <form onSubmit={handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto px-4 md:px-6 py-5">
            <Tabs defaultValue="details">
              <TabsList className="mb-6 w-full">
                <TabsTrigger value="details" className="relative flex-1 gap-1.5">
                  <FileText className="h-3.5 w-3.5" />
                  {t("tabDetails")}
                  <TabDot has={tabErrors.details} />
                </TabsTrigger>
                <TabsTrigger value="template" className="relative flex-1 gap-1.5">
                  <MailIcon className="h-3.5 w-3.5" />
                  {t("tabTemplate")}
                  {selectedTemplate && <span className="ml-1 h-1.5 w-1.5 rounded-full bg-green-500" />}
                  <TabDot has={tabErrors.template} />
                </TabsTrigger>
              </TabsList>

              {/* ── Details Tab ───────────────────────────────────────────── */}
              <TabsContent value="details" className="mt-0 space-y-5">
                <F label={t("nameLabel")} required error={e.name ? t("nameRequired") : undefined}>
                  <Input {...register("name")} placeholder={t("namePlaceholder")} autoFocus />
                </F>

                <F label={tc("description")} error={e.description?.message}>
                  <Textarea
                    {...register("description")}
                    placeholder={t("descriptionPlaceholder")}
                    rows={4}
                    className="resize-none text-sm"
                  />
                </F>

                <Separator />

                <div className="space-y-2">
                  <Label className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                    {tc("status")}
                  </Label>
                  <Controller
                    control={control}
                    name="status"
                    render={({ field }) => (
                      <div className="grid grid-cols-3 gap-2">
                        {STATUS_OPTIONS.map((opt) => {
                          const active = field.value === opt;
                          return (
                            <button
                              key={opt}
                              type="button"
                              onClick={() => field.onChange(opt)}
                              className={`rounded-lg border px-3 py-2.5 text-left transition-all ${
                                active
                                  ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                                  : "border-border hover:border-muted-foreground/40 hover:bg-muted/30"
                              }`}
                            >
                              <div className="mb-0.5 flex items-center gap-1.5">
                                {active && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" />}
                                <span className="font-medium text-sm">{tm(`campaigns.statuses.${opt}`)}</span>
                              </div>
                              <p className="text-muted-foreground text-xs">{t(`statusDesc.${opt}`)}</p>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  />
                </div>
              </TabsContent>

              {/* ── Template Tab ──────────────────────────────────────────── */}
              <TabsContent value="template" className="mt-0 space-y-5">
                {templates.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed py-12 text-center">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                      <MailIcon className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">{t("noTemplates")}</p>
                      <p className="mt-0.5 text-muted-foreground text-xs">{t("noTemplatesDesc")}</p>
                    </div>
                    <Link href="/dashboard/marketing/templates" onClick={() => setOpen(false)}>
                      <Button size="sm" variant="outline">
                        <ExternalLink className="mr-2 h-3.5 w-3.5" />
                        {t("goToTemplates")}
                      </Button>
                    </Link>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <F label={t("selectTemplate")} error={e.templateId?.message}>
                        <span /> {/* spacer for F layout */}
                      </F>
                      <Link
                        href="/dashboard/marketing/templates"
                        className="mb-1 flex shrink-0 items-center gap-1 text-muted-foreground text-xs hover:text-foreground"
                        onClick={() => setOpen(false)}
                      >
                        <ExternalLink className="h-3 w-3" />
                        {t("manage")}
                      </Link>
                    </div>

                    <Controller
                      control={control}
                      name="templateId"
                      render={({ field }) => (
                        <div className="-mt-3 space-y-2">
                          {/* None option */}
                          <button
                            type="button"
                            onClick={() => field.onChange(null)}
                            className={`w-full rounded-lg border px-4 py-3 text-left transition-all ${
                              !field.value
                                ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                                : "border-border hover:border-muted-foreground/40 hover:bg-muted/20"
                            }`}
                          >
                            <span className="text-muted-foreground text-sm">{t("noTemplateOption")}</span>
                          </button>

                          {/* Template cards */}
                          {templates.map((tpl) => {
                            const catKey = tpl.category in CATEGORY_CONFIG ? tpl.category : "general";
                            const catCfg = CATEGORY_CONFIG[catKey];
                            const active = field.value === tpl.id;
                            return (
                              <button
                                key={tpl.id}
                                type="button"
                                onClick={() => field.onChange(tpl.id)}
                                className={`w-full rounded-lg border px-4 py-3 text-left transition-all ${
                                  active
                                    ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                                    : "border-border hover:border-muted-foreground/40 hover:bg-muted/20"
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex min-w-0 items-center gap-2">
                                    {active && <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />}
                                    <span className="truncate font-medium text-sm">{tpl.name}</span>
                                  </div>
                                  <Badge variant="outline" className={`shrink-0 text-[10px] ${catCfg.className}`}>
                                    {tm(`templateCategories.${catKey}`)}
                                  </Badge>
                                </div>
                                <p className="mt-1 truncate pl-0 text-muted-foreground text-xs">
                                  {t("subjectLine", { subject: tpl.subject })}
                                </p>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    />

                    {/* Selected template summary */}
                    {selectedTemplate && (
                      <div className="space-y-1 rounded-lg border bg-muted/40 px-4 py-3">
                        <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                          {t("selectedTemplate")}
                        </p>
                        <p className="font-semibold text-sm">{selectedTemplate.name}</p>
                        <p className="text-muted-foreground text-xs">
                          {t("subjectLine", { subject: selectedTemplate.subject })}
                        </p>
                      </div>
                    )}
                  </>
                )}
              </TabsContent>
            </Tabs>
          </div>

          {/* Footer */}
          <DialogFooter className="border-t bg-muted/30 px-4 md:px-6 py-4">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={isSubmitting} className="min-w-[120px]">
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEditing ? t("saveChanges") : t("create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
