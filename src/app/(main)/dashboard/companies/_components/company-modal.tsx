"use client";

import { useEffect, useState } from "react";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowUpRightIcon,
  BuildingIcon,
  EyeIcon,
  GitMerge,
  Loader2Icon,
  MapPinIcon,
  PencilIcon,
  ReceiptIcon,
  TagIcon,
  TrashIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import {
  checkCompanyDuplicates,
  createCompany,
  createCompanyCategory,
  createCompanyType,
  deleteCompany,
  updateCompany,
} from "@/actions/crm";
import { AssigneeSelect, decodeAssignee, encodeAssignee } from "@/components/crm/assignee-select";
import { CreatableLookupCombobox } from "@/components/crm/creatable-lookup-combobox";
import { DuplicateHint } from "@/components/crm/duplicate-hint";
import { GeoAddressFields } from "@/components/crm/geo-address-fields";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useDuplicateWatch } from "@/hooks/use-duplicate-watch";
import { actionErrorMessage, isPlanLimit } from "@/lib/action-error";

import { MergeCompaniesModal } from "./merge-companies-modal";

type LookupItem = { id: string; name: string };

const companySchema = z.object({
  name: z.string().min(1, "Company name is required"),
  type: z.string().default("prospect"),
  status: z.string().default("active"),
  companyCategoryId: z.string().optional().nullable(),
  companyTypeId: z.string().optional().nullable(),
  ownerId: z.string().optional().nullable(),
  groupId: z.string().optional().nullable(),
  assigneeValue: z.string().optional(),
  industry: z.string().optional(),
  employeeCount: z.coerce.number().optional().nullable(),
  annualRevenue: z.coerce.number().optional().nullable(),
  website: z.string().optional(),
  mainPhone: z.string().optional(),
  mainEmail: z.string().email("Invalid email").optional().or(z.literal("")),
  linkedinUrl: z.string().optional(),
  description: z.string().optional(),
  source: z.string().optional(),
  leadScore: z.coerce.number().optional().nullable(),
  tags: z.string().optional(),
  street: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zipCode: z.string().optional(),
  country: z.string().optional(),
  vatNumber: z.string().optional(),
  sdiCode: z.string().optional(),
});
type CompanyFormValues = z.infer<typeof companySchema>;

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

export function CompanyModal({
  company,
  children,
  categories = [],
  companyTypes = [],
}: {
  // biome-ignore lint/suspicious/noExplicitAny: typing this as the schema row surfaces three real mismatches — annualRevenue and employeeCount come back from the numeric columns as strings while the form expects numbers, and CompaniesTable passes a narrower row. That is a change to the form, not to this signature.
  company?: any;
  children: React.ReactNode;
  categories?: LookupItem[];
  companyTypes?: LookupItem[];
}) {
  const t = useTranslations("companies");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [duplicates, setDuplicates] = useState<Awaited<ReturnType<typeof checkCompanyDuplicates>>>([]);
  const [pendingPayload, setPendingPayload] = useState<Record<string, unknown> | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState<string | null>(null);
  const isEditing = !!company;
  const searchParams = useSearchParams();

  const [localCategories, setLocalCategories] = useState<LookupItem[]>(categories);
  const [localTypes, setLocalTypes] = useState<LookupItem[]>(companyTypes);

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

  const form = useForm<CompanyFormValues>({
    resolver: zodResolver(companySchema),
    defaultValues: {
      name: company?.name || "",
      type: company?.type || "prospect",
      status: company?.status || "active",
      companyCategoryId: company?.companyCategoryId ?? null,
      companyTypeId: company?.companyTypeId ?? null,
      industry: company?.industry || "",
      employeeCount: company?.employeeCount ?? null,
      annualRevenue: company?.annualRevenue ?? null,
      website: company?.website || "",
      mainPhone: company?.mainPhone || "",
      mainEmail: company?.mainEmail || "",
      linkedinUrl: company?.linkedinUrl || "",
      description: company?.description || "",
      source: company?.source || "",
      leadScore: company?.leadScore ?? null,
      ownerId: company?.ownerId || null,
      groupId: company?.groupId || null,
      assigneeValue: encodeAssignee(company?.ownerId, company?.groupId),
      tags: company?.tags ? company.tags.join(", ") : "",
      street: company?.street || "",
      city: company?.city || "",
      state: company?.state || "",
      zipCode: company?.zipCode || "",
      country: company?.country || "",
      vatNumber: company?.vatNumber || "",
      sdiCode: company?.sdiCode || "",
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
  // The same check the form runs on save, run while the name is still being typed
  // (rilievo U-13). Told at the end, the user has already filled in three tabs for
  // a company that was here all along.
  const typedName = form.watch("name");
  const typedWebsite = form.watch("website");
  const typedMainEmail = form.watch("mainEmail");
  const dupWatch = useDuplicateWatch(
    () =>
      checkCompanyDuplicates({
        name: typedName,
        website: typedWebsite,
        mainEmail: typedMainEmail,
        excludeId: company?.id,
      }),
    [typedName, typedWebsite, typedMainEmail],
    // Nothing to warn about while the dialog is shut, and the form keeps its
    // values after it closes.
    { enabled: open },
  );

  useEffect(() => {
    if (open && company) {
      form.reset({
        name: company.name || "",
        type: company.type || "prospect",
        status: company.status || "active",
        companyCategoryId: company.companyCategoryId ?? null,
        companyTypeId: company.companyTypeId ?? null,
        industry: company.industry || "",
        employeeCount: company.employeeCount ?? null,
        annualRevenue: company.annualRevenue ?? null,
        website: company.website || "",
        mainPhone: company.mainPhone || "",
        mainEmail: company.mainEmail || "",
        linkedinUrl: company.linkedinUrl || "",
        description: company.description || "",
        source: company.source || "",
        leadScore: company.leadScore ?? null,
        ownerId: company.ownerId || null,
        groupId: company.groupId || null,
        assigneeValue: encodeAssignee(company.ownerId, company.groupId),
        tags: company.tags ? company.tags.join(", ") : "",
        street: company.street || "",
        city: company.city || "",
        state: company.state || "",
        zipCode: company.zipCode || "",
        country: company.country || "",
        vatNumber: company.vatNumber || "",
        sdiCode: company.sdiCode || "",
      });
    }
  }, [open, company, form.reset]); // eslint-disable-line react-hooks/exhaustive-deps

  const e = errors;
  const tabErrors = {
    info: !!(
      e.name ||
      e.type ||
      e.status ||
      e.industry ||
      e.employeeCount ||
      e.annualRevenue ||
      e.website ||
      e.mainPhone ||
      e.mainEmail ||
      e.linkedinUrl
    ),
    crm: !!(e.source || e.leadScore || e.tags),
    address: !!(e.street || e.city || e.state || e.zipCode || e.country),
    billing: !!(e.vatNumber || e.sdiCode),
  };

  const saveCompany = async (payload: Record<string, unknown>) => {
    try {
      if (isEditing) {
        const result = await updateCompany(company.id, payload);
        if (!result.ok) {
          // The guards write these messages for the person reading them; the old
          // catch-all threw them away (audit rilievo U-01).
          toast.error(result.message, {
            action: isPlanLimit(result)
              ? {
                  label: "Upgrade",
                  onClick: () => {
                    window.location.href = "/dashboard/settings/billing";
                  },
                }
              : undefined,
          });
          return;
        }
        toast.success(t("updateSuccess"));
      } else {
        const result = await createCompany(payload);
        if (!result.ok) {
          // The guards write these messages for the person reading them; the old
          // catch-all threw them away (audit rilievo U-01).
          toast.error(result.message, {
            action: isPlanLimit(result)
              ? {
                  label: "Upgrade",
                  onClick: () => {
                    window.location.href = "/dashboard/settings/billing";
                  },
                }
              : undefined,
          });
          return;
        }
        toast.success(t("createSuccess"));
      }
      setOpen(false);
      setDuplicates([]);
      setPendingPayload(null);
      form.reset();
    } catch (err) {
      toast.error(actionErrorMessage(err, t("form.saveFailed")));
    }
  };

  const onSubmit = async (data: CompanyFormValues) => {
    const { ownerId, groupId } = decodeAssignee(data.assigneeValue);
    const payload = {
      ...data,
      ownerId,
      groupId,
      assigneeValue: undefined,
      companyCategoryId: data.companyCategoryId || null,
      companyTypeId: data.companyTypeId || null,
    };

    const found = await checkCompanyDuplicates({
      name: data.name,
      website: data.website,
      mainEmail: data.mainEmail,
      excludeId: company?.id,
    });
    if (found.length > 0) {
      setDuplicates(found);
      setPendingPayload(payload);
      return;
    }

    await saveCompany(payload);
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
        <DialogContent className="flex flex-col gap-0 p-0 sm:max-w-[700px]">
          <DialogHeader className="border-b px-6 pt-6 pb-4">
            <div className="flex items-center justify-between gap-2">
              <DialogTitle className="text-lg">
                {isEditing ? t("form.editTitle", { name: company.name }) : t("form.newTitle")}
              </DialogTitle>
              {isEditing && company && (
                <Link href={`/dashboard/companies/${company.id}`} onClick={() => setOpen(false)}>
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
              <DuplicateHint
                titleKey="companyTitle"
                matches={dupWatch.matches.map((d) => ({
                  id: d.id,
                  label: d.name,
                  detail: d.mainEmail ?? d.website,
                  href: `/dashboard/companies/${d.id}`,
                }))}
                onDismiss={dupWatch.dismiss}
              />

              <Tabs defaultValue="info">
                <TabsList className="mb-5 w-full">
                  <TabsTrigger value="info" className="relative flex-1 gap-1.5">
                    <BuildingIcon className="h-3.5 w-3.5" />
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
                  <TabsTrigger value="billing" className="relative flex-1 gap-1.5">
                    <ReceiptIcon className="h-3.5 w-3.5" />
                    {t("form.tabs.billing")}
                    <TabDot has={tabErrors.billing} />
                  </TabsTrigger>
                </TabsList>

                {/* ── Info Tab ─────────────────────────────────────────────── */}
                <TabsContent value="info" className="mt-0 grid grid-cols-2 gap-x-4 gap-y-4">
                  <div className="col-span-2">
                    <F label={tc("name")} required error={e.name?.message}>
                      <Input {...register("name")} placeholder="Acme Corp" />
                    </F>
                  </div>
                  <F label={t("form.type")} error={e.type?.message}>
                    <Controller
                      control={control}
                      name="type"
                      render={({ field }) => (
                        <Select onValueChange={field.onChange} value={field.value}>
                          <SelectTrigger>
                            <SelectValue placeholder={t("form.selectType")} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="prospect">{t("types.prospect")}</SelectItem>
                            <SelectItem value="customer">{t("types.customer")}</SelectItem>
                            <SelectItem value="partner">{t("types.partner")}</SelectItem>
                            <SelectItem value="vendor">{t("types.vendor")}</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </F>
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
                            <SelectItem value="active">{t("statuses.active")}</SelectItem>
                            <SelectItem value="inactive">{t("statuses.inactive")}</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </F>
                  <F label={t("form.category")} error={e.companyCategoryId?.message}>
                    <Controller
                      control={control}
                      name="companyCategoryId"
                      render={({ field }) => (
                        <CreatableLookupCombobox
                          value={field.value ?? null}
                          onChange={field.onChange}
                          items={localCategories}
                          onAddItem={(item) =>
                            setLocalCategories((prev) => [...prev, item].sort((a, b) => a.name.localeCompare(b.name)))
                          }
                          onCreate={createCompanyCategory}
                          placeholder={t("form.selectCategory")}
                          createPrefix={t("form.createNew")}
                        />
                      )}
                    />
                  </F>
                  <F label={t("form.companyType")} error={e.companyTypeId?.message}>
                    <Controller
                      control={control}
                      name="companyTypeId"
                      render={({ field }) => (
                        <CreatableLookupCombobox
                          value={field.value ?? null}
                          onChange={field.onChange}
                          items={localTypes}
                          onAddItem={(item) =>
                            setLocalTypes((prev) => [...prev, item].sort((a, b) => a.name.localeCompare(b.name)))
                          }
                          onCreate={createCompanyType}
                          placeholder={t("form.selectCompanyType")}
                          createPrefix={t("form.createNew")}
                        />
                      )}
                    />
                  </F>
                  <F label={t("industry")} error={e.industry?.message}>
                    <Input {...register("industry")} placeholder="Technology" />
                  </F>
                  <F label={t("form.employeeCount")} error={e.employeeCount?.message}>
                    <Input {...register("employeeCount")} type="number" min={0} placeholder="0" />
                  </F>
                  <F label={t("form.annualRevenue")} error={e.annualRevenue?.message}>
                    <Input {...register("annualRevenue")} type="number" min={0} placeholder="0" />
                  </F>
                  <F label={tc("website")} error={e.website?.message}>
                    <Input {...register("website")} placeholder="https://acme.com" />
                  </F>
                  <F label={tc("phone")} error={e.mainPhone?.message}>
                    <Input {...register("mainPhone")} type="tel" placeholder="+39 02 1234567" />
                  </F>
                  <F label={tc("email")} error={e.mainEmail?.message}>
                    <Input {...register("mainEmail")} type="email" placeholder="info@acme.com" />
                  </F>
                  <F label="LinkedIn URL" error={e.linkedinUrl?.message}>
                    <Input {...register("linkedinUrl")} placeholder="https://linkedin.com/company/…" />
                  </F>
                  <div className="col-span-2">
                    <F label={tc("description")} error={e.description?.message}>
                      <Textarea
                        {...register("description")}
                        placeholder="Brief description of the company…"
                        className="min-h-[80px] resize-y"
                      />
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
                  <F label={t("form.leadScore")} error={e.leadScore?.message}>
                    <Input {...register("leadScore")} type="number" min={0} max={100} placeholder="0" />
                  </F>
                  <div className="col-span-2">
                    <F label={t("form.tags")} error={e.tags?.message}>
                      <Input {...register("tags")} placeholder="tech, enterprise, key-account" />
                    </F>
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

                {/* ── Billing Tab ──────────────────────────────────────────── */}
                <TabsContent value="billing" className="mt-0 grid grid-cols-2 gap-x-4 gap-y-4">
                  <F label={t("form.vatNumber")} error={e.vatNumber?.message}>
                    <Input {...register("vatNumber")} placeholder="IT01234567890" />
                  </F>
                  <F label={t("form.sdiCode")} error={e.sdiCode?.message}>
                    <Input {...register("sdiCode")} placeholder="XXXXXXX" />
                  </F>
                  <div className="col-span-2 rounded-md border bg-muted/30 px-4 py-3 text-muted-foreground text-xs">
                    <p className="mb-1 font-medium text-foreground">Italian e-invoicing</p>
                    <p>
                      The <strong>SDI Code</strong> (Codice Destinatario) is the 7-character code used for electronic
                      invoice routing via the Sistema di Interscambio.
                    </p>
                  </div>
                </TabsContent>
              </Tabs>
            </div>

            {duplicates.length > 0 && pendingPayload && (
              <div className="border-t bg-amber-50 px-6 py-4 dark:bg-amber-950/30">
                <p className="mb-2 font-semibold text-amber-800 text-sm dark:text-amber-300">
                  Similar companies already exist:
                </p>
                <ul className="mb-3 space-y-1.5">
                  {duplicates.map((d) => (
                    <li key={d.id} className="flex items-center gap-2 text-amber-700 text-sm dark:text-amber-400">
                      <Link
                        href={`/dashboard/companies/${d.id}`}
                        className="underline underline-offset-2 hover:text-amber-900"
                        target="_blank"
                      >
                        {d.name}
                      </Link>
                      {d.mainEmail && <span className="text-xs opacity-70">{d.mainEmail}</span>}
                      {d.website && <span className="text-xs opacity-70">{d.website}</span>}
                      {isEditing && company && (
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
                  <Button type="button" size="sm" onClick={() => saveCompany(pendingPayload)}>
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
                {isEditing ? t("form.saveChanges") : t("form.createCompany")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {isEditing && company && mergeTargetId && (
        <MergeCompaniesModal
          keepId={company.id}
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

export function DeleteCompanyButton({ id }: { id: string }) {
  const t = useTranslations("companies");
  const [isDeleting, setIsDeleting] = useState(false);
  const handleDelete = async () => {
    if (!confirm(t("deleteConfirm"))) return;
    try {
      setIsDeleting(true);
      await deleteCompany(id);
      toast.success(t("deleteSuccess"));
    } catch {
      toast.error(t("deleteFailed"));
    } finally {
      setIsDeleting(false);
    }
  };
  return (
    <Button
      variant="ghost"
      size="icon"
      className="text-destructive hover:text-destructive/90"
      onClick={handleDelete}
      disabled={isDeleting}
    >
      {isDeleting ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <TrashIcon className="h-4 w-4" />}
    </Button>
  );
}

export function CompanyActions({
  company,
  categories = [],
  companyTypes = [],
}: {
  // biome-ignore lint/suspicious/noExplicitAny: typing this as the schema row surfaces three real mismatches — annualRevenue and employeeCount come back from the numeric columns as strings while the form expects numbers, and CompaniesTable passes a narrower row. That is a change to the form, not to this signature.
  company: any;
  categories?: LookupItem[];
  companyTypes?: LookupItem[];
}) {
  return (
    <div className="flex items-center justify-end gap-2">
      <Link href={`/dashboard/companies/${company.id}`}>
        <Button variant="ghost" size="icon">
          <EyeIcon className="h-4 w-4" />
        </Button>
      </Link>
      <CompanyModal company={company} categories={categories} companyTypes={companyTypes}>
        <Button variant="ghost" size="icon">
          <PencilIcon className="h-4 w-4" />
        </Button>
      </CompanyModal>
      <DeleteCompanyButton id={company.id} />
    </div>
  );
}
