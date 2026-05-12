"use client";

import { useEffect, useState } from "react";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  EyeIcon,
  FileTextIcon,
  GitMerge,
  Loader2Icon,
  MapPinIcon,
  PencilIcon,
  TagIcon,
  TrashIcon,
  UserIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { checkContactDuplicates, createContact, deleteContact, getCompanies, updateContact } from "@/actions/crm";
import { AssigneeSelect, decodeAssignee, encodeAssignee } from "@/components/crm/assignee-select";
import { GeoAddressFields } from "@/components/crm/geo-address-fields";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

import { MergeContactsModal } from "./merge-contacts-modal";

const contactSchema = z.object({
  firstName: z.string().min(1, "Required"),
  lastName: z.string().min(1, "Required"),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  phone: z.string().optional(),
  mobile: z.string().optional(),
  jobTitle: z.string().optional(),
  department: z.string().optional(),
  linkedinUrl: z.string().optional(),
  companyId: z.string().optional().nullable(),
  ownerId: z.string().optional().nullable(),
  groupId: z.string().optional().nullable(),
  assigneeValue: z.string().optional(),
  status: z.string().default("active"),
  source: z.string().optional(),
  leadScore: z.coerce.number().optional().nullable(),
  tags: z.string().optional(),
  marketingConsent: z.boolean().default(false),
  notes: z.string().optional(),
  street: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zipCode: z.string().optional(),
  country: z.string().optional(),
});
type ContactFormValues = z.infer<typeof contactSchema>;

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
      <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function Section({ title }: { title: string }) {
  return (
    <p className="col-span-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60 mt-2 mb-0.5 border-b pb-1">
      {title}
    </p>
  );
}

export function ContactModal({ contact, children }: { contact?: any; children: React.ReactNode }) {
  const t = useTranslations("contacts");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
  const [duplicates, setDuplicates] = useState<Awaited<ReturnType<typeof checkContactDuplicates>>>([]);
  const [pendingPayload, setPendingPayload] = useState<Record<string, unknown> | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState<string | null>(null);
  const isEditing = !!contact;
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!isEditing && searchParams?.get("new") === "true") setOpen(true);
  }, [isEditing, searchParams]);

  useEffect(() => {
    if (open) {
      getCompanies().then((rows) => setCompanies(rows.map((c) => ({ id: c.id, name: c.name }))));
    }
  }, [open]);

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

  const form = useForm<ContactFormValues>({
    resolver: zodResolver(contactSchema),
    defaultValues: {
      firstName: contact?.firstName || "",
      lastName: contact?.lastName || "",
      email: contact?.email || "",
      phone: contact?.phone || "",
      mobile: contact?.mobile || "",
      jobTitle: contact?.jobTitle || "",
      department: contact?.department || "",
      linkedinUrl: contact?.linkedinUrl || "",
      companyId: contact?.companyId || null,
      ownerId: contact?.ownerId || null,
      groupId: contact?.groupId || null,
      assigneeValue: encodeAssignee(contact?.ownerId, contact?.groupId),
      status: contact?.status || "active",
      source: contact?.source || "",
      leadScore: contact?.leadScore ?? null,
      tags: contact?.tags ? contact.tags.join(", ") : "",
      marketingConsent: contact?.marketingConsent || false,
      notes: contact?.notes || "",
      street: contact?.street || "",
      city: contact?.city || "",
      state: contact?.state || "",
      zipCode: contact?.zipCode || "",
      country: contact?.country || "",
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
    if (open && contact) {
      form.reset({
        firstName: contact.firstName || "",
        lastName: contact.lastName || "",
        email: contact.email || "",
        phone: contact.phone || "",
        mobile: contact.mobile || "",
        jobTitle: contact.jobTitle || "",
        department: contact.department || "",
        linkedinUrl: contact.linkedinUrl || "",
        companyId: contact.companyId || null,
        ownerId: contact.ownerId || null,
        groupId: contact.groupId || null,
        assigneeValue: encodeAssignee(contact.ownerId, contact.groupId),
        status: contact.status || "active",
        source: contact.source || "",
        leadScore: contact.leadScore ?? null,
        tags: contact.tags ? contact.tags.join(", ") : "",
        marketingConsent: contact.marketingConsent || false,
        notes: contact.notes || "",
        street: contact.street || "",
        city: contact.city || "",
        state: contact.state || "",
        zipCode: contact.zipCode || "",
        country: contact.country || "",
      });
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const e = errors;
  const tabErrors = {
    info: !!(
      e.firstName ||
      e.lastName ||
      e.email ||
      e.phone ||
      e.mobile ||
      e.jobTitle ||
      e.department ||
      e.linkedinUrl
    ),
    crm: !!(e.status || e.source || e.leadScore || e.tags),
    address: !!(e.street || e.city || e.state || e.zipCode || e.country),
    notes: !!e.notes,
  };

  const saveContact = async (payload: Record<string, unknown>) => {
    try {
      if (isEditing) {
        await updateContact(contact.id, payload);
        toast.success(t("updateSuccess"));
      } else {
        await createContact(payload);
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

  const onSubmit = async (data: ContactFormValues) => {
    const { ownerId, groupId } = decodeAssignee(data.assigneeValue);
    const payload = { ...data, ownerId, groupId, assigneeValue: undefined };

    const found = await checkContactDuplicates({
      email: data.email,
      phone: data.phone,
      firstName: data.firstName,
      lastName: data.lastName,
      excludeId: contact?.id,
    });
    if (found.length > 0) {
      setDuplicates(found);
      setPendingPayload(payload);
      return;
    }

    await saveContact(payload);
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
        <DialogContent className="sm:max-w-[700px] max-h-[90vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-6 pt-6 pb-4 border-b">
            <DialogTitle className="text-lg">
              {isEditing
                ? t("form.editTitle", { name: `${contact.firstName} ${contact.lastName}` })
                : t("form.newTitle")}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col flex-1 min-h-0">
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <Tabs defaultValue="info">
                <TabsList className="w-full mb-5">
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
                <TabsContent value="info" className="grid grid-cols-2 gap-x-4 gap-y-4 mt-0">
                  <F label={t("firstName")} required error={e.firstName?.message}>
                    <Input {...register("firstName")} placeholder="Mario" />
                  </F>
                  <F label={t("lastName")} required error={e.lastName?.message}>
                    <Input {...register("lastName")} placeholder="Rossi" />
                  </F>
                  <F label={tc("email")} error={e.email?.message}>
                    <Input {...register("email")} type="email" placeholder="mario@example.com" />
                  </F>
                  <F label={t("jobTitle")} error={e.jobTitle?.message}>
                    <Input {...register("jobTitle")} placeholder="Sales Manager" />
                  </F>
                  <F label={tc("phone")} error={e.phone?.message}>
                    <Input {...register("phone")} type="tel" placeholder="+39 0464 1234567" />
                  </F>
                  <F label={t("mobile")} error={e.mobile?.message}>
                    <Input {...register("mobile")} type="tel" placeholder="+39 345 1234567" />
                  </F>
                  <F label={t("department")} error={e.department?.message}>
                    <Input {...register("department")} placeholder="Sales, Marketing…" />
                  </F>
                  <F label={t("linkedIn")} error={e.linkedinUrl?.message}>
                    <Input {...register("linkedinUrl")} placeholder="https://linkedin.com/in/…" />
                  </F>
                  <div className="col-span-2">
                    <F label={tc("company")} error={e.companyId?.message}>
                      <Controller
                        control={control}
                        name="companyId"
                        render={({ field }) => (
                          <Select
                            onValueChange={(v) => field.onChange(v === "__none__" ? null : v)}
                            value={field.value ?? "__none__"}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder={t("form.noCompany")} />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">{t("form.noCompany")}</SelectItem>
                              {companies.map((c) => (
                                <SelectItem key={c.id} value={c.id}>
                                  {c.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      />
                    </F>
                  </div>
                </TabsContent>

                {/* ── CRM Tab ──────────────────────────────────────────────── */}
                <TabsContent value="crm" className="grid grid-cols-2 gap-x-4 gap-y-4 mt-0">
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
                            <SelectItem value="active">{t("statuses.active")}</SelectItem>
                            <SelectItem value="inactive">{t("statuses.inactive")}</SelectItem>
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
                  <F label={t("leadScore")} error={e.leadScore?.message}>
                    <Input {...register("leadScore")} type="number" min={0} max={100} placeholder="0" />
                  </F>
                  <F label={t("form.tags")} error={e.tags?.message}>
                    <Input {...register("tags")} placeholder="tech, startup, b2b" />
                  </F>
                  <div className="col-span-2">
                    <Controller
                      control={control}
                      name="marketingConsent"
                      render={({ field }) => (
                        <div className="flex items-center justify-between rounded-lg border px-4 py-3">
                          <div>
                            <p className="text-sm font-medium">{t("form.marketingConsent")}</p>
                            <p className="text-xs text-muted-foreground">{t("form.marketingConsentDesc")}</p>
                          </div>
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </div>
                      )}
                    />
                  </div>
                </TabsContent>

                {/* ── Address Tab ──────────────────────────────────────────── */}
                <TabsContent value="address" className="grid grid-cols-2 gap-x-4 gap-y-4 mt-0">
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
              <div className="px-6 py-4 border-t bg-amber-50 dark:bg-amber-950/30">
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-300 mb-2">
                  Similar contacts already exist:
                </p>
                <ul className="mb-3 space-y-1.5">
                  {duplicates.map((d) => (
                    <li key={d.id} className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
                      <Link
                        href={`/dashboard/contacts/${d.id}`}
                        className="underline underline-offset-2 hover:text-amber-900"
                        target="_blank"
                      >
                        {d.firstName} {d.lastName}
                      </Link>
                      {d.email && <span className="text-xs opacity-70">{d.email}</span>}
                      {isEditing && contact && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-6 px-2 text-xs ml-auto border-amber-400 text-amber-700 hover:bg-amber-100"
                          onClick={() => setMergeTargetId(d.id)}
                        >
                          <GitMerge className="h-3 w-3 mr-1" />
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
                  <Button type="button" size="sm" onClick={() => saveContact(pendingPayload)}>
                    Save anyway
                  </Button>
                </div>
              </div>
            )}

            <DialogFooter className="px-6 py-4 border-t bg-muted/30">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {tc("cancel")}
              </Button>
              <Button type="submit" disabled={isSubmitting} className="min-w-[100px]">
                {isSubmitting && <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />}
                {isEditing ? t("form.saveChanges") : t("form.createContact")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {isEditing && contact && mergeTargetId && (
        <MergeContactsModal
          keepId={contact.id}
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

export function DeleteContactButton({ id }: { id: string }) {
  const t = useTranslations("contacts");
  const [isDeleting, setIsDeleting] = useState(false);
  const handleDelete = async () => {
    if (!confirm(t("deleteConfirm"))) return;
    try {
      setIsDeleting(true);
      await deleteContact(id);
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

export function ContactActions({ contact }: { contact: any }) {
  return (
    <div className="flex items-center gap-2 justify-end">
      <Link href={`/dashboard/contacts/${contact.id}`}>
        <Button variant="ghost" size="icon">
          <EyeIcon className="h-4 w-4" />
        </Button>
      </Link>
      <ContactModal contact={contact}>
        <Button variant="ghost" size="icon">
          <PencilIcon className="h-4 w-4" />
        </Button>
      </ContactModal>
      <DeleteContactButton id={contact.id} />
    </div>
  );
}
