"use client";

import { useEffect, useState, useTransition } from "react";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowRightIcon,
  ArrowUpRightIcon,
  BuildingIcon,
  EyeIcon,
  FileTextIcon,
  GitMerge,
  Loader2Icon,
  MapPinIcon,
  PencilIcon,
  SparklesIcon,
  TagIcon,
  TrashIcon,
  UserIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import {
  checkLeadDuplicates,
  convertLead,
  createCompanyCategory,
  createCompanyType,
  createLead,
  deleteLead,
  updateLead,
} from "@/actions/crm";
import { AssigneeSelect, decodeAssignee, encodeAssignee } from "@/components/crm/assignee-select";
import { CreatableLookupCombobox } from "@/components/crm/creatable-lookup-combobox";
import { GeoAddressFields } from "@/components/crm/geo-address-fields";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

import { MergeLeadsModal } from "./merge-leads-modal";

const leadSchema = z.object({
  firstName: z.string().min(1, "Required"),
  lastName: z.string().min(1, "Required"),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  phone: z.string().optional(),
  mobile: z.string().optional(),
  jobTitle: z.string().optional(),
  companyName: z.string().optional(),
  industry: z.string().optional(),
  website: z.string().optional(),
  ownerId: z.string().optional().nullable(),
  groupId: z.string().optional().nullable(),
  assigneeValue: z.string().optional(),
  status: z.string().default("new"),
  source: z.string().optional(),
  rating: z.string().optional(),
  leadScore: z.coerce.number().optional().nullable(),
  leadTypeId: z.string().optional().nullable(),
  leadCategoryId: z.string().optional().nullable(),
  tags: z.string().optional(),
  marketingConsent: z.boolean().default(false),
  notes: z.string().optional(),
  street: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zipCode: z.string().optional(),
  country: z.string().optional(),
});
type LeadFormValues = z.infer<typeof leadSchema>;

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

type LookupItem = { id: string; name: string };

export function LeadModal({
  lead,
  children,
  categories = [],
  companyTypes = [],
}: {
  lead?: any;
  children: React.ReactNode;
  categories?: LookupItem[];
  companyTypes?: LookupItem[];
}) {
  const t = useTranslations("leads");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [duplicates, setDuplicates] = useState<Awaited<ReturnType<typeof checkLeadDuplicates>>>([]);
  const [pendingPayload, setPendingPayload] = useState<Record<string, unknown> | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState<string | null>(null);
  const [localCategories, setLocalCategories] = useState<LookupItem[]>(categories);
  const [localTypes, setLocalTypes] = useState<LookupItem[]>(companyTypes);
  const isEditing = !!lead;
  const searchParams = useSearchParams();

  useEffect(() => {
    setLocalCategories(categories);
  }, [categories]);
  useEffect(() => {
    setLocalTypes(companyTypes);
  }, [companyTypes]);

  useEffect(() => {
    if (!isEditing && searchParams?.get("new") === "true") setOpen(true);
  }, [isEditing, searchParams]);

  const sourceOptions = [
    { value: "website", label: tc("sources.website") },
    { value: "referral", label: tc("sources.referral") },
    { value: "linkedin", label: tc("sources.linkedin") },
    { value: "cold_outreach", label: tc("sources.cold_outreach") },
    { value: "trade_show", label: tc("sources.trade_show") },
    { value: "advertisement", label: tc("sources.advertisement") },
    { value: "email_campaign", label: tc("sources.email_campaign") },
    { value: "other", label: tc("sources.other") },
  ];

  const form = useForm<LeadFormValues>({
    resolver: zodResolver(leadSchema),
    defaultValues: {
      firstName: lead?.firstName || "",
      lastName: lead?.lastName || "",
      email: lead?.email || "",
      phone: lead?.phone || "",
      mobile: lead?.mobile || "",
      jobTitle: lead?.jobTitle || "",
      companyName: lead?.companyName || "",
      industry: lead?.industry || "",
      website: lead?.website || "",
      ownerId: lead?.ownerId || null,
      groupId: lead?.groupId || null,
      assigneeValue: encodeAssignee(lead?.ownerId, lead?.groupId),
      status: lead?.status || "new",
      source: lead?.source || "",
      rating: lead?.rating || "",
      leadScore: lead?.leadScore ?? null,
      leadTypeId: lead?.leadTypeId ?? null,
      leadCategoryId: lead?.leadCategoryId ?? null,
      tags: lead?.tags ? lead.tags.join(", ") : "",
      marketingConsent: lead?.marketingConsent || false,
      notes: lead?.notes || "",
      street: lead?.street || "",
      city: lead?.city || "",
      state: lead?.state || "",
      zipCode: lead?.zipCode || "",
      country: lead?.country || "",
    },
  });

  const {
    register,
    control,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = form;

  useEffect(() => {
    if (open && lead) {
      form.reset({
        firstName: lead.firstName || "",
        lastName: lead.lastName || "",
        email: lead.email || "",
        phone: lead.phone || "",
        mobile: lead.mobile || "",
        jobTitle: lead.jobTitle || "",
        companyName: lead.companyName || "",
        industry: lead.industry || "",
        website: lead.website || "",
        ownerId: lead.ownerId || null,
        groupId: lead.groupId || null,
        assigneeValue: encodeAssignee(lead.ownerId, lead.groupId),
        status: lead.status || "new",
        source: lead.source || "",
        rating: lead.rating || "",
        leadScore: lead.leadScore ?? null,
        leadTypeId: lead.leadTypeId ?? null,
        leadCategoryId: lead.leadCategoryId ?? null,
        tags: lead.tags ? lead.tags.join(", ") : "",
        marketingConsent: lead.marketingConsent || false,
        notes: lead.notes || "",
        street: lead.street || "",
        city: lead.city || "",
        state: lead.state || "",
        zipCode: lead.zipCode || "",
        country: lead.country || "",
      });
    }
  }, [open, lead, form.reset]);

  const e = errors;
  const tabErrors = {
    info: !!(
      e.firstName ||
      e.lastName ||
      e.email ||
      e.phone ||
      e.mobile ||
      e.jobTitle ||
      e.companyName ||
      e.industry ||
      e.website
    ),
    crm: !!(e.status || e.source || e.rating || e.leadScore || e.leadTypeId || e.leadCategoryId || e.tags),
    address: !!(e.street || e.city || e.state || e.zipCode || e.country),
    notes: !!e.notes,
  };

  const saveLead = async (payload: Record<string, unknown>) => {
    try {
      if (isEditing) {
        await updateLead(lead.id, payload);
        toast.success(t("updateSuccess"));
      } else {
        await createLead(payload);
        toast.success(t("createSuccess"));
      }
      setOpen(false);
      setDuplicates([]);
      setPendingPayload(null);
      form.reset();
    } catch {
      toast.error(t("form.saveFailed"));
    }
  };

  const onSubmit = async (data: LeadFormValues) => {
    const { ownerId, groupId } = decodeAssignee(data.assigneeValue);
    const payload = { ...data, ownerId, groupId, assigneeValue: undefined };

    const found = await checkLeadDuplicates({
      email: data.email,
      phone: data.phone,
      firstName: data.firstName,
      lastName: data.lastName,
      excludeId: lead?.id,
    });
    if (found.length > 0) {
      setDuplicates(found);
      setPendingPayload(payload);
      return;
    }

    await saveLead(payload);
  };

  const TabDot = ({ has }: { has: boolean }) =>
    has ? <span className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-destructive" /> : null;

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) {
            form.reset();
            setDuplicates([]);
            setPendingPayload(null);
          }
        }}
      >
        <DialogTrigger asChild>{children}</DialogTrigger>
        <DialogContent className="flex max-h-[90vh] flex-col gap-0 p-0 sm:max-w-[700px]">
          <DialogHeader className="border-b px-6 pt-6 pb-4">
            <div className="flex items-center justify-between gap-2">
              <DialogTitle className="text-lg">
                {isEditing ? t("form.editTitle", { name: `${lead.firstName} ${lead.lastName}` }) : t("form.newTitle")}
              </DialogTitle>
              {isEditing && lead && (
                <Link href={`/dashboard/leads/${lead.id}`} onClick={() => setOpen(false)}>
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
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <Tabs defaultValue="info">
                <TabsList className="mb-5 w-full">
                  <TabsTrigger value="info" className="relative flex-1 gap-1.5">
                    <UserIcon className="h-3.5 w-3.5" />
                    {t("form.tabs.info")}
                    <TabDot has={tabErrors.info} />
                  </TabsTrigger>
                  <TabsTrigger value="crm" className="relative flex-1 gap-1.5">
                    <TagIcon className="h-3.5 w-3.5" />
                    {t("form.tabs.crm")}
                    <TabDot has={tabErrors.crm} />
                  </TabsTrigger>
                  <TabsTrigger value="address" className="relative flex-1 gap-1.5">
                    <MapPinIcon className="h-3.5 w-3.5" />
                    {t("form.tabs.address")}
                    <TabDot has={tabErrors.address} />
                  </TabsTrigger>
                  <TabsTrigger value="notes" className="relative flex-1 gap-1.5">
                    <FileTextIcon className="h-3.5 w-3.5" />
                    {t("form.tabs.notes")}
                    <TabDot has={tabErrors.notes} />
                  </TabsTrigger>
                </TabsList>

                {/* ── Info Tab ─────────────────────────────────────────────── */}
                <TabsContent value="info" className="mt-0 grid grid-cols-2 gap-x-4 gap-y-4">
                  <F label={tc("firstName")} required error={e.firstName?.message}>
                    <Input {...register("firstName")} placeholder="Mario" />
                  </F>
                  <F label={tc("lastName")} required error={e.lastName?.message}>
                    <Input {...register("lastName")} placeholder="Rossi" />
                  </F>
                  <F label={tc("email")} error={e.email?.message}>
                    <Input {...register("email")} type="email" placeholder="mario@example.com" />
                  </F>
                  <F label={tc("jobTitle")} error={e.jobTitle?.message}>
                    <Input {...register("jobTitle")} placeholder="Sales Manager" />
                  </F>
                  <F label={tc("phone")} error={e.phone?.message}>
                    <Input {...register("phone")} type="tel" placeholder="+39 0464 1234567" />
                  </F>
                  <F label={tc("mobile")} error={e.mobile?.message}>
                    <Input {...register("mobile")} type="tel" placeholder="+39 345 1234567" />
                  </F>
                  <F label={t("form.companyName")} error={e.companyName?.message}>
                    <Input {...register("companyName")} placeholder="Acme Corp" />
                  </F>
                  <F label={tc("industry")} error={e.industry?.message}>
                    <Input {...register("industry")} placeholder="Technology, Finance…" />
                  </F>
                  <div className="col-span-2">
                    <F label={tc("website")} error={e.website?.message}>
                      <Input {...register("website")} placeholder="https://acme.com" />
                    </F>
                  </div>
                </TabsContent>

                {/* ── CRM Tab ──────────────────────────────────────────────── */}
                <TabsContent value="crm" className="mt-0 grid grid-cols-2 gap-x-4 gap-y-4">
                  <div className="col-span-2">
                    <F label={t("form.assignedTo")}>
                      <Controller
                        control={control}
                        name="assigneeValue"
                        render={({ field }) => <AssigneeSelect value={field.value ?? null} onChange={field.onChange} />}
                      />
                    </F>
                  </div>
                  <F label={t("form.status")} error={e.status?.message}>
                    <Controller
                      control={control}
                      name="status"
                      render={({ field }) => (
                        <Select onValueChange={field.onChange} value={field.value}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="new">{t("statuses.new")}</SelectItem>
                            <SelectItem value="contacting">{t("statuses.contacting")}</SelectItem>
                            <SelectItem value="engaged">{t("statuses.engaged")}</SelectItem>
                            <SelectItem value="qualified">{t("statuses.qualified")}</SelectItem>
                            <SelectItem value="unqualified">{t("statuses.unqualified")}</SelectItem>
                            <SelectItem value="converted">{t("converted")}</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </F>
                  <F label={t("form.source")} error={e.source?.message}>
                    <Controller
                      control={control}
                      name="source"
                      render={({ field }) => (
                        <Select onValueChange={field.onChange} value={field.value ?? ""}>
                          <SelectTrigger>
                            <SelectValue placeholder={t("form.selectSource")} />
                          </SelectTrigger>
                          <SelectContent>
                            {sourceOptions.map((o) => (
                              <SelectItem key={o.value} value={o.value}>
                                {o.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </F>
                  <F label={t("form.rating")} error={e.rating?.message}>
                    <Controller
                      control={control}
                      name="rating"
                      render={({ field }) => (
                        <Select onValueChange={field.onChange} value={field.value ?? ""}>
                          <SelectTrigger>
                            <SelectValue placeholder="—" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="hot">🔥 {t("ratings.hot")}</SelectItem>
                            <SelectItem value="warm">☀️ {t("ratings.warm")}</SelectItem>
                            <SelectItem value="cold">❄️ {t("ratings.cold")}</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </F>
                  <F label={t("form.leadScore")} error={e.leadScore?.message}>
                    <Input {...register("leadScore")} type="number" min={0} max={100} placeholder="0" />
                  </F>
                  <F label={t("form.leadType")} error={e.leadTypeId?.message}>
                    <Controller
                      control={control}
                      name="leadTypeId"
                      render={({ field }) => (
                        <CreatableLookupCombobox
                          value={field.value ?? null}
                          onChange={field.onChange}
                          items={localTypes}
                          onAddItem={(item) =>
                            setLocalTypes((prev) => [...prev, item].sort((a, b) => a.name.localeCompare(b.name)))
                          }
                          onCreate={createCompanyType}
                          placeholder={t("form.selectLeadType")}
                          createPrefix={t("form.createNew")}
                        />
                      )}
                    />
                  </F>
                  <F label={t("form.leadCategory")} error={e.leadCategoryId?.message}>
                    <Controller
                      control={control}
                      name="leadCategoryId"
                      render={({ field }) => (
                        <CreatableLookupCombobox
                          value={field.value ?? null}
                          onChange={field.onChange}
                          items={localCategories}
                          onAddItem={(item) =>
                            setLocalCategories((prev) => [...prev, item].sort((a, b) => a.name.localeCompare(b.name)))
                          }
                          onCreate={createCompanyCategory}
                          placeholder={t("form.selectLeadCategory")}
                          createPrefix={t("form.createNew")}
                        />
                      )}
                    />
                  </F>
                  <div className="col-span-2">
                    <F label={t("form.tags")} error={e.tags?.message}>
                      <Input {...register("tags")} placeholder="tech, startup, b2b" />
                    </F>
                  </div>
                  <div className="col-span-2">
                    <Controller
                      control={control}
                      name="marketingConsent"
                      render={({ field }) => (
                        <div className="flex items-center justify-between rounded-lg border px-4 py-3">
                          <div>
                            <p className="font-medium text-sm">{tc("marketingConsent")}</p>
                            <p className="text-muted-foreground text-xs">{tc("marketingConsentDesc")}</p>
                          </div>
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </div>
                      )}
                    />
                  </div>
                </TabsContent>

                {/* ── Address Tab ──────────────────────────────────────────── */}
                <TabsContent value="address" className="mt-0 grid grid-cols-2 gap-x-4 gap-y-4">
                  <GeoAddressFields
                    control={control}
                    setValue={setValue}
                    watch={watch}
                    errors={e}
                    labels={{
                      street: tc("street"),
                      city: tc("city"),
                      state: tc("state"),
                      zipCode: tc("zipCode"),
                      country: tc("country"),
                    }}
                  />
                </TabsContent>

                {/* ── Notes Tab ────────────────────────────────────────────── */}
                <TabsContent value="notes" className="mt-0">
                  <F label={tc("notes")} error={e.notes?.message}>
                    <Textarea
                      {...register("notes")}
                      placeholder={t("form.notesPlaceholder")}
                      className="min-h-[180px] resize-y"
                    />
                  </F>
                </TabsContent>
              </Tabs>
            </div>

            {duplicates.length > 0 && pendingPayload && (
              <div className="border-t bg-amber-50 px-6 py-4 dark:bg-amber-950/30">
                <p className="mb-2 font-semibold text-amber-800 text-sm dark:text-amber-300">
                  Similar leads already exist:
                </p>
                <ul className="mb-3 space-y-1.5">
                  {duplicates.map((d) => (
                    <li key={d.id} className="flex items-center gap-2 text-amber-700 text-sm dark:text-amber-400">
                      <Link
                        href={`/dashboard/leads/${d.id}`}
                        className="underline underline-offset-2 hover:text-amber-900"
                        target="_blank"
                      >
                        {d.firstName} {d.lastName}
                      </Link>
                      {d.email && <span className="text-xs opacity-70">{d.email}</span>}
                      {isEditing && lead && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="ml-auto h-6 border-amber-400 px-2 text-amber-700 text-xs hover:bg-amber-100"
                          onClick={() => setMergeTargetId(d.id)}
                        >
                          <GitMerge className="mr-1 h-3 w-3" />
                          Merge
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setDuplicates([]);
                      setPendingPayload(null);
                    }}
                  >
                    Go back
                  </Button>
                  <Button type="button" size="sm" onClick={() => saveLead(pendingPayload)}>
                    Save anyway
                  </Button>
                </div>
              </div>
            )}

            <DialogFooter className="border-t bg-muted/30 px-6 py-4">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {tc("cancel")}
              </Button>
              <Button type="submit" disabled={isSubmitting} className="min-w-[100px]">
                {isSubmitting && <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />}
                {isEditing ? t("form.saveChanges") : t("form.createLead")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {isEditing && lead && mergeTargetId && (
        <MergeLeadsModal
          keepId={lead.id}
          mergeId={mergeTargetId}
          open={true}
          onOpenChange={(v) => {
            if (!v) setMergeTargetId(null);
          }}
        />
      )}
    </>
  );
}

export function DeleteLeadButton({ lead, redirectTo }: { lead: any; redirectTo?: string }) {
  const t = useTranslations("leads");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    try {
      setIsDeleting(true);
      await deleteLead(lead.id);
      toast.success(t("deleteSuccess"));
      setOpen(false);
      if (redirectTo) router.push(redirectTo);
    } catch {
      toast.error(t("deleteFailed"));
    } finally {
      setIsDeleting(false);
    }
  };

  const isConverted = !!lead.isConverted;
  const hasContact = !!lead.convertedToContactId;
  const hasCompany = !!lead.convertedToCompanyId;
  const hasDeal = !!lead.convertedToDealId;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="text-destructive hover:text-destructive/90"
          disabled={isDeleting}
        >
          {isDeleting ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <TrashIcon className="h-4 w-4" />}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isConverted ? t("deleteConvertedTitle") : t("deleteTitle")}</DialogTitle>
          <DialogDescription>{isConverted ? t("deleteConvertedDesc") : t("deleteConfirm")}</DialogDescription>
        </DialogHeader>
        {isConverted && (hasContact || hasCompany || hasDeal) && (
          <ul className="list-inside list-disc space-y-1 text-muted-foreground text-sm">
            {hasContact && <li>{t("deleteConvertedContact")}</li>}
            {hasCompany && <li>{t("deleteConvertedCompany")}</li>}
            {hasDeal && <li>{t("deleteConvertedDeal")}</li>}
          </ul>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{t("deleteCancel")}</Button>
          </DialogClose>
          <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
            {isDeleting && <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />}
            {isConverted ? t("deleteConvertedConfirm") : t("deleteTitle")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function QuickConvertButton({ lead }: { lead: any }) {
  const t = useTranslations("leads");
  const [open, setOpen] = useState(false);
  const [shouldCreateDeal, setShouldCreateDeal] = useState(true);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleConvert = () => {
    startTransition(async () => {
      try {
        const result = await convertLead(lead.id, shouldCreateDeal);
        toast.success(t("convertSuccessToast"));
        setOpen(false);
        if (result.dealId) {
          router.push(`/dashboard/pipeline?dealId=${result.dealId}`);
        } else {
          router.push(`/dashboard/contacts?contactId=${result.contactId}`);
        }
      } catch {
        toast.error(t("convertErrorToast"));
      }
    });
  };

  const leadName = `${lead.firstName} ${lead.lastName}`;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" title={t("convertLead")} disabled={isPending}>
          {isPending ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <SparklesIcon className="h-4 w-4" />}
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("convertLead")}</DialogTitle>
          <DialogDescription>{t("convertLeadDesc")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2 rounded-lg border bg-muted/30 p-3 text-sm">
          <p className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">Verrà creato</p>
          <div className="flex items-center gap-2">
            <UserIcon className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
            <span>
              Contatto: <span className="font-medium">{leadName}</span>
            </span>
          </div>
          {lead.companyName && (
            <div className="flex items-center gap-2">
              <BuildingIcon className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
              <span>
                Azienda: <span className="font-medium">{lead.companyName}</span>
              </span>
            </div>
          )}
        </div>

        <Separator />

        <div className="flex items-center justify-between gap-3">
          <div className="space-y-0.5">
            <Label htmlFor="quick-create-deal" className="font-medium text-sm">
              {t("convertCreateDeal")}
            </Label>
            <p className="text-muted-foreground text-xs">
              Crea un'opportunità nella pipeline collegata a questo cliente
            </p>
          </div>
          <Switch
            id="quick-create-deal"
            checked={shouldCreateDeal}
            onCheckedChange={setShouldCreateDeal}
            disabled={isPending}
          />
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={isPending}>
              {t("convertCancel")}
            </Button>
          </DialogClose>
          <Button type="button" onClick={handleConvert} disabled={isPending} className="gap-2">
            {isPending ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <ArrowRightIcon className="h-4 w-4" />}
            {t("convertConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function LeadActions({
  lead,
  categories,
  companyTypes,
}: {
  lead: any;
  categories?: LookupItem[];
  companyTypes?: LookupItem[];
}) {
  return (
    <div className="flex items-center gap-2">
      <Link href={`/dashboard/leads/${lead.id}`}>
        <Button variant="ghost" size="icon">
          <EyeIcon className="h-4 w-4" />
        </Button>
      </Link>
      <LeadModal lead={lead} categories={categories} companyTypes={companyTypes}>
        <Button variant="ghost" size="icon">
          <PencilIcon className="h-4 w-4" />
        </Button>
      </LeadModal>
      {lead.status !== "converted" && <QuickConvertButton lead={lead} />}
      <DeleteLeadButton lead={lead} />
    </div>
  );
}
