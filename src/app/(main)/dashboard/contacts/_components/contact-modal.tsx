"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2Icon, PencilIcon, TrashIcon, EyeIcon, UserIcon, TagIcon, MapPinIcon, FileTextIcon } from "lucide-react";
import Link from "next/link";

import { createContact, deleteContact, updateContact, getCompanies } from "@/actions/crm";
import { AssigneeSelect, encodeAssignee, decodeAssignee } from "@/components/crm/assignee-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";

// ── Schema ────────────────────────────────────────────────────────────────────
const contactSchema = z.object({
  firstName:        z.string().min(1, "Required"),
  lastName:         z.string().min(1, "Required"),
  email:            z.string().email("Invalid email").optional().or(z.literal("")),
  phone:            z.string().optional(),
  mobile:           z.string().optional(),
  jobTitle:         z.string().optional(),
  department:       z.string().optional(),
  linkedinUrl:      z.string().optional(),
  companyId:        z.string().optional().nullable(),
  ownerId:          z.string().optional().nullable(),
  groupId:          z.string().optional().nullable(),
  assigneeValue:    z.string().optional(),
  status:           z.string().default("active"),
  source:           z.string().optional(),
  leadScore:        z.coerce.number().optional().nullable(),
  tags:             z.string().optional(),
  marketingConsent: z.boolean().default(false),
  notes:            z.string().optional(),
  street:           z.string().optional(),
  city:             z.string().optional(),
  state:            z.string().optional(),
  zipCode:          z.string().optional(),
  country:          z.string().optional(),
});
type ContactFormValues = z.infer<typeof contactSchema>;

const SOURCE_OPTIONS = [
  { value: "website",        label: "Website" },
  { value: "referral",       label: "Referral" },
  { value: "linkedin",       label: "LinkedIn" },
  { value: "cold_outreach",  label: "Cold Outreach" },
  { value: "trade_show",     label: "Trade Show" },
  { value: "advertisement",  label: "Advertisement" },
  { value: "email_campaign", label: "Email Campaign" },
  { value: "other",          label: "Other" },
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

// ── Section header ────────────────────────────────────────────────────────────
function Section({ title }: { title: string }) {
  return (
    <p className="col-span-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60 mt-2 mb-0.5 border-b pb-1">
      {title}
    </p>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export function ContactModal({ contact, children }: { contact?: any; children: React.ReactNode }) {
  const [open, setOpen]           = useState(false);
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
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

  const form = useForm<ContactFormValues>({
    resolver: zodResolver(contactSchema),
    defaultValues: {
      firstName:        contact?.firstName        || "",
      lastName:         contact?.lastName         || "",
      email:            contact?.email            || "",
      phone:            contact?.phone            || "",
      mobile:           contact?.mobile           || "",
      jobTitle:         contact?.jobTitle         || "",
      department:       contact?.department       || "",
      linkedinUrl:      contact?.linkedinUrl      || "",
      companyId:        contact?.companyId        || null,
      ownerId:          contact?.ownerId          || null,
      groupId:          contact?.groupId          || null,
      assigneeValue:    encodeAssignee(contact?.ownerId, contact?.groupId),
      status:           contact?.status           || "active",
      source:           contact?.source           || "",
      leadScore:        contact?.leadScore        ?? null,
      tags:             contact?.tags             ? contact.tags.join(", ") : "",
      marketingConsent: contact?.marketingConsent || false,
      notes:            contact?.notes            || "",
      street:           contact?.street           || "",
      city:             contact?.city             || "",
      state:            contact?.state            || "",
      zipCode:          contact?.zipCode          || "",
      country:          contact?.country          || "",
    },
  });

  const { register, control, handleSubmit, formState: { errors, isSubmitting } } = form;

  // Tab error indicators
  const e = errors;
  const tabErrors = {
    info:    !!(e.firstName || e.lastName || e.email || e.phone || e.mobile || e.jobTitle || e.department || e.linkedinUrl),
    crm:     !!(e.status || e.source || e.leadScore || e.tags),
    address: !!(e.street || e.city || e.state || e.zipCode || e.country),
    notes:   !!e.notes,
  };

  const onSubmit = async (data: ContactFormValues) => {
    try {
      const { ownerId, groupId } = decodeAssignee(data.assigneeValue);
      const payload = { ...data, ownerId, groupId, assigneeValue: undefined };
      if (isEditing) {
        await updateContact(contact.id, payload);
        toast.success("Contact updated.");
      } else {
        await createContact(payload);
        toast.success("Contact created.");
      }
      setOpen(false);
      form.reset();
    } catch {
      toast.error("Failed to save contact.");
    }
  };

  const TabDot = ({ has }: { has: boolean }) =>
    has ? <span className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-destructive" /> : null;

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) form.reset(); }}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <DialogTitle className="text-lg">
            {isEditing ? `Edit Contact — ${contact.firstName} ${contact.lastName}` : "New Contact"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <Tabs defaultValue="info">
              <TabsList className="w-full mb-5">
                <TabsTrigger value="info" className="relative flex-1 gap-1.5">
                  <UserIcon className="h-3.5 w-3.5" />Info
                  <TabDot has={tabErrors.info} />
                </TabsTrigger>
                <TabsTrigger value="crm" className="relative flex-1 gap-1.5">
                  <TagIcon className="h-3.5 w-3.5" />CRM
                  <TabDot has={tabErrors.crm} />
                </TabsTrigger>
                <TabsTrigger value="address" className="relative flex-1 gap-1.5">
                  <MapPinIcon className="h-3.5 w-3.5" />Address
                  <TabDot has={tabErrors.address} />
                </TabsTrigger>
                <TabsTrigger value="notes" className="relative flex-1 gap-1.5">
                  <FileTextIcon className="h-3.5 w-3.5" />Notes
                  <TabDot has={tabErrors.notes} />
                </TabsTrigger>
              </TabsList>

              {/* ── Info Tab ─────────────────────────────────────────────── */}
              <TabsContent value="info" className="grid grid-cols-2 gap-x-4 gap-y-4 mt-0">
                <F label="First Name" required error={e.firstName?.message}>
                  <Input {...register("firstName")} placeholder="Jane" />
                </F>
                <F label="Last Name" required error={e.lastName?.message}>
                  <Input {...register("lastName")} placeholder="Doe" />
                </F>
                <F label="Email" error={e.email?.message} >
                  <Input {...register("email")} type="email" placeholder="jane@example.com" />
                </F>
                <F label="Job Title" error={e.jobTitle?.message}>
                  <Input {...register("jobTitle")} placeholder="Sales Manager" />
                </F>
                <F label="Phone" error={e.phone?.message}>
                  <Input {...register("phone")} type="tel" placeholder="+39 02 1234567" />
                </F>
                <F label="Mobile" error={e.mobile?.message}>
                  <Input {...register("mobile")} type="tel" placeholder="+39 340 1234567" />
                </F>
                <F label="Department" error={e.department?.message}>
                  <Input {...register("department")} placeholder="Sales, Marketing…" />
                </F>
                <F label="LinkedIn URL" error={e.linkedinUrl?.message}>
                  <Input {...register("linkedinUrl")} placeholder="https://linkedin.com/in/…" />
                </F>
                <div className="col-span-2">
                  <F label="Company" error={e.companyId?.message}>
                    <Controller
                      control={control}
                      name="companyId"
                      render={({ field }) => (
                        <Select
                          onValueChange={(v) => field.onChange(v === "__none__" ? null : v)}
                          value={field.value ?? "__none__"}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="— No company —" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">— No company —</SelectItem>
                            {companies.map((c) => (
                              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
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
                  <F label="Assigned To">
                    <Controller control={control} name="assigneeValue" render={({ field }) => (
                      <AssigneeSelect value={field.value ?? null} onChange={field.onChange} />
                    )} />
                  </F>
                </div>
                <F label="Status" error={e.status?.message}>
                  <Controller control={control} name="status" render={({ field }) => (
                    <Select onValueChange={field.onChange} value={field.value}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="inactive">Inactive</SelectItem>
                      </SelectContent>
                    </Select>
                  )} />
                </F>
                <F label="Source" error={e.source?.message}>
                  <Controller control={control} name="source" render={({ field }) => (
                    <Select onValueChange={field.onChange} value={field.value ?? ""}>
                      <SelectTrigger><SelectValue placeholder="— Select source —" /></SelectTrigger>
                      <SelectContent>
                        {SOURCE_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )} />
                </F>
                <F label="Lead Score (0–100)" error={e.leadScore?.message}>
                  <Input {...register("leadScore")} type="number" min={0} max={100} placeholder="0" />
                </F>
                <F label="Tags (comma-separated)" error={e.tags?.message}>
                  <Input {...register("tags")} placeholder="tech, startup, b2b" />
                </F>
                <div className="col-span-2">
                  <Controller control={control} name="marketingConsent" render={({ field }) => (
                    <div className="flex items-center justify-between rounded-lg border px-4 py-3">
                      <div>
                        <p className="text-sm font-medium">Marketing Consent</p>
                        <p className="text-xs text-muted-foreground">User agreed to receive marketing communications</p>
                      </div>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </div>
                  )} />
                </div>
              </TabsContent>

              {/* ── Address Tab ──────────────────────────────────────────── */}
              <TabsContent value="address" className="grid grid-cols-2 gap-x-4 gap-y-4 mt-0">
                <div className="col-span-2">
                  <F label="Street" error={e.street?.message}>
                    <Input {...register("street")} placeholder="Via Roma 1" />
                  </F>
                </div>
                <F label="City" error={e.city?.message}>
                  <Input {...register("city")} placeholder="Milan" />
                </F>
                <F label="State / Province" error={e.state?.message}>
                  <Input {...register("state")} placeholder="MI" />
                </F>
                <F label="ZIP / Postal Code" error={e.zipCode?.message}>
                  <Input {...register("zipCode")} placeholder="20100" />
                </F>
                <F label="Country" error={e.country?.message}>
                  <Input {...register("country")} placeholder="Italy" />
                </F>
              </TabsContent>

              {/* ── Notes Tab ────────────────────────────────────────────── */}
              <TabsContent value="notes" className="mt-0">
                <F label="Notes" error={e.notes?.message}>
                  <Textarea
                    {...register("notes")}
                    placeholder="Internal notes about this contact…"
                    className="min-h-[180px] resize-y"
                  />
                </F>
              </TabsContent>
            </Tabs>
          </div>

          <DialogFooter className="px-6 py-4 border-t bg-muted/30">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting} className="min-w-[100px]">
              {isSubmitting && <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />}
              {isEditing ? "Save Changes" : "Create Contact"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Delete ────────────────────────────────────────────────────────────────────
export function DeleteContactButton({ id }: { id: string }) {
  const [isDeleting, setIsDeleting] = useState(false);
  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this contact?")) return;
    try {
      setIsDeleting(true);
      await deleteContact(id);
      toast.success("Contact deleted.");
    } catch {
      toast.error("Failed to delete contact.");
    } finally {
      setIsDeleting(false);
    }
  };
  return (
    <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive/90" onClick={handleDelete} disabled={isDeleting}>
      {isDeleting ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <TrashIcon className="h-4 w-4" />}
    </Button>
  );
}

export function ContactActions({ contact }: { contact: any }) {
  return (
    <div className="flex items-center gap-2 justify-end">
      <Link href={`/dashboard/contacts/${contact.id}`}>
        <Button variant="ghost" size="icon"><EyeIcon className="h-4 w-4" /></Button>
      </Link>
      <ContactModal contact={contact}>
        <Button variant="ghost" size="icon"><PencilIcon className="h-4 w-4" /></Button>
      </ContactModal>
      <DeleteContactButton id={contact.id} />
    </div>
  );
}
