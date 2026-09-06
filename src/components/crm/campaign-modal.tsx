"use client";

import { useState } from "react";

import Link from "next/link";

import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, ExternalLink, FileText, Loader2, MailIcon, Pencil, Plus, TargetIcon } from "lucide-react";
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

// ── Schema ─────────────────────────────────────────────────────────────────────
const campaignSchema = z.object({
  name: z.string().min(1, "Campaign name is required"),
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
const CATEGORY_CONFIG: Record<string, { label: string; className: string }> = {
  general: { label: "General", className: "border-slate-300 text-slate-600" },
  welcome: { label: "Welcome", className: "border-green-300 text-green-700 bg-green-50" },
  followup: { label: "Follow-up", className: "border-blue-300 text-blue-700 bg-blue-50" },
  promotional: { label: "Promotional", className: "border-violet-300 text-violet-700 bg-violet-50" },
  transactional: { label: "Transactional", className: "border-amber-300 text-amber-700 bg-amber-50" },
};

const STATUS_OPTIONS = [
  { value: "draft", label: "Draft", desc: "Not yet ready to send" },
  { value: "active", label: "Active", desc: "Currently running" },
  { value: "completed", label: "Completed", desc: "Send finished" },
];

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
export function CampaignModal({ templates, campaign, onSuccess, children }: CampaignModalProps) {
  const [open, setOpen] = useState(false);
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
  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);

  const tabErrors = {
    details: !!(e.name || e.description || e.status),
    template: !!e.templateId,
  };

  async function onSubmit(data: FormValues) {
    try {
      const payload = { ...data, templateId: data.templateId || null };
      if (isEditing) {
        await updateMarketingCampaign(campaign.id, payload);
        toast.success("Campaign updated");
      } else {
        await createMarketingCampaign(payload);
        toast.success("Campaign created");
      }
      setOpen(false);
      form.reset();
      onSuccess?.();
    } catch {
      toast.error("Failed to save campaign");
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
          New Campaign
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
            {isEditing ? `Edit — ${campaign.name}` : "New Campaign"}
          </DialogTitle>
        </DialogHeader>

        {/* Body */}
        <form onSubmit={handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto px-4 md:px-6 py-5">
            <Tabs defaultValue="details">
              <TabsList className="mb-6 w-full">
                <TabsTrigger value="details" className="relative flex-1 gap-1.5">
                  <FileText className="h-3.5 w-3.5" />
                  Details
                  <TabDot has={tabErrors.details} />
                </TabsTrigger>
                <TabsTrigger value="template" className="relative flex-1 gap-1.5">
                  <MailIcon className="h-3.5 w-3.5" />
                  Email Template
                  {selectedTemplate && <span className="ml-1 h-1.5 w-1.5 rounded-full bg-green-500" />}
                  <TabDot has={tabErrors.template} />
                </TabsTrigger>
              </TabsList>

              {/* ── Details Tab ───────────────────────────────────────────── */}
              <TabsContent value="details" className="mt-0 space-y-5">
                <F label="Campaign Name" required error={e.name?.message}>
                  <Input {...register("name")} placeholder="e.g. Q2 Product Launch, Summer Promo…" autoFocus />
                </F>

                <F label="Description" error={e.description?.message}>
                  <Textarea
                    {...register("description")}
                    placeholder="Describe the goal and target audience for this campaign…"
                    rows={4}
                    className="resize-none text-sm"
                  />
                </F>

                <Separator />

                <div className="space-y-2">
                  <Label className="font-medium text-muted-foreground text-xs uppercase tracking-wide">Status</Label>
                  <Controller
                    control={control}
                    name="status"
                    render={({ field }) => (
                      <div className="grid grid-cols-3 gap-2">
                        {STATUS_OPTIONS.map((opt) => {
                          const active = field.value === opt.value;
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => field.onChange(opt.value)}
                              className={`rounded-lg border px-3 py-2.5 text-left transition-all ${
                                active
                                  ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                                  : "border-border hover:border-muted-foreground/40 hover:bg-muted/30"
                              }`}
                            >
                              <div className="mb-0.5 flex items-center gap-1.5">
                                {active && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" />}
                                <span className="font-medium text-sm">{opt.label}</span>
                              </div>
                              <p className="text-muted-foreground text-xs">{opt.desc}</p>
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
                      <p className="font-medium text-sm">No templates yet</p>
                      <p className="mt-0.5 text-muted-foreground text-xs">
                        Create an email template before assigning it to a campaign.
                      </p>
                    </div>
                    <Link href="/dashboard/marketing/templates" onClick={() => setOpen(false)}>
                      <Button size="sm" variant="outline">
                        <ExternalLink className="mr-2 h-3.5 w-3.5" />
                        Go to Templates
                      </Button>
                    </Link>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <F label="Select Template" error={e.templateId?.message}>
                        <span /> {/* spacer for F layout */}
                      </F>
                      <Link
                        href="/dashboard/marketing/templates"
                        className="mb-1 flex shrink-0 items-center gap-1 text-muted-foreground text-xs hover:text-foreground"
                        onClick={() => setOpen(false)}
                      >
                        <ExternalLink className="h-3 w-3" />
                        Manage
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
                            <span className="text-muted-foreground text-sm">No template (assign later)</span>
                          </button>

                          {/* Template cards */}
                          {templates.map((t) => {
                            const catCfg = CATEGORY_CONFIG[t.category] ?? CATEGORY_CONFIG.general;
                            const active = field.value === t.id;
                            return (
                              <button
                                key={t.id}
                                type="button"
                                onClick={() => field.onChange(t.id)}
                                className={`w-full rounded-lg border px-4 py-3 text-left transition-all ${
                                  active
                                    ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                                    : "border-border hover:border-muted-foreground/40 hover:bg-muted/20"
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex min-w-0 items-center gap-2">
                                    {active && <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />}
                                    <span className="truncate font-medium text-sm">{t.name}</span>
                                  </div>
                                  <Badge variant="outline" className={`shrink-0 text-[10px] ${catCfg.className}`}>
                                    {catCfg.label}
                                  </Badge>
                                </div>
                                <p className="mt-1 truncate pl-0 text-muted-foreground text-xs">Subject: {t.subject}</p>
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
                          Selected template
                        </p>
                        <p className="font-semibold text-sm">{selectedTemplate.name}</p>
                        <p className="text-muted-foreground text-xs">Subject: {selectedTemplate.subject}</p>
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
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting} className="min-w-[120px]">
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEditing ? "Save Changes" : "Create Campaign"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
