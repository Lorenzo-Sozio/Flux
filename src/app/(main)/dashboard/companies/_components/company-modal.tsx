"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2Icon, PencilIcon, TrashIcon, EyeIcon, BuildingIcon, TagIcon, MapPinIcon, ReceiptIcon } from "lucide-react";
import Link from "next/link";

import { createCompany, deleteCompany, updateCompany } from "@/actions/crm";
import { AssigneeSelect, encodeAssignee, decodeAssignee } from "@/components/crm/assignee-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";

// ── Schema ────────────────────────────────────────────────────────────────────
const companySchema = z.object({
  name:          z.string().min(1, "Company name is required"),
  type:          z.string().default("prospect"),
  status:        z.string().default("active"),
  ownerId:       z.string().optional().nullable(),
  groupId:       z.string().optional().nullable(),
  assigneeValue: z.string().optional(),
  industry:      z.string().optional(),
  employeeCount: z.coerce.number().optional().nullable(),
  annualRevenue: z.coerce.number().optional().nullable(),
  website:       z.string().optional(),
  mainPhone:     z.string().optional(),
  mainEmail:     z.string().email("Invalid email").optional().or(z.literal("")),
  linkedinUrl:   z.string().optional(),
  description:   z.string().optional(),
  source:        z.string().optional(),
  leadScore:     z.coerce.number().optional().nullable(),
  tags:          z.string().optional(),
  street:        z.string().optional(),
  city:          z.string().optional(),
  state:         z.string().optional(),
  zipCode:       z.string().optional(),
  country:       z.string().optional(),
  vatNumber:     z.string().optional(),
  sdiCode:       z.string().optional(),
});
type CompanyFormValues = z.infer<typeof companySchema>;

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

// ── Main Component ────────────────────────────────────────────────────────────
export function CompanyModal({ company, children }: { company?: any; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const isEditing = !!company;
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!isEditing && searchParams?.get("new") === "true") setOpen(true);
  }, [isEditing, searchParams]);


  const form = useForm<CompanyFormValues>({
    resolver: zodResolver(companySchema),
    defaultValues: {
      name:          company?.name          || "",
      type:          company?.type          || "prospect",
      status:        company?.status        || "active",
      industry:      company?.industry      || "",
      employeeCount: company?.employeeCount ?? null,
      annualRevenue: company?.annualRevenue ?? null,
      website:       company?.website       || "",
      mainPhone:     company?.mainPhone     || "",
      mainEmail:     company?.mainEmail     || "",
      linkedinUrl:   company?.linkedinUrl   || "",
      description:   company?.description   || "",
      source:        company?.source        || "",
      leadScore:     company?.leadScore     ?? null,
      ownerId:       company?.ownerId       || null,
      groupId:       company?.groupId       || null,
      assigneeValue: encodeAssignee(company?.ownerId, company?.groupId),
      tags:          company?.tags          ? company.tags.join(", ") : "",
      street:        company?.street        || "",
      city:          company?.city          || "",
      state:         company?.state         || "",
      zipCode:       company?.zipCode       || "",
      country:       company?.country       || "",
      vatNumber:     company?.vatNumber     || "",
      sdiCode:       company?.sdiCode       || "",
    },
  });

  const { register, control, handleSubmit, formState: { errors, isSubmitting } } = form;

  const e = errors;
  const tabErrors = {
    info:    !!(e.name || e.type || e.status || e.industry || e.employeeCount || e.annualRevenue || e.website || e.mainPhone || e.mainEmail || e.linkedinUrl),
    crm:     !!(e.source || e.leadScore || e.tags),
    address: !!(e.street || e.city || e.state || e.zipCode || e.country),
    billing: !!(e.vatNumber || e.sdiCode),
  };

  const onSubmit = async (data: CompanyFormValues) => {
    try {
      const { ownerId, groupId } = decodeAssignee(data.assigneeValue);
      const payload = { ...data, ownerId, groupId, assigneeValue: undefined };
      if (isEditing) {
        await updateCompany(company.id, payload);
        toast.success("Company updated.");
      } else {
        await createCompany(payload);
        toast.success("Company created.");
      }
      setOpen(false);
      form.reset();
    } catch {
      toast.error("Failed to save company.");
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
            {isEditing ? `Edit Company — ${company.name}` : "New Company"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <Tabs defaultValue="info">
              <TabsList className="w-full mb-5">
                <TabsTrigger value="info" className="relative flex-1 gap-1.5">
                  <BuildingIcon className="h-3.5 w-3.5" />Info
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
                <TabsTrigger value="billing" className="relative flex-1 gap-1.5">
                  <ReceiptIcon className="h-3.5 w-3.5" />Billing
                  <TabDot has={tabErrors.billing} />
                </TabsTrigger>
              </TabsList>

              {/* ── Info Tab ─────────────────────────────────────────────── */}
              <TabsContent value="info" className="grid grid-cols-2 gap-x-4 gap-y-4 mt-0">
                <div className="col-span-2">
                  <F label="Company Name" required error={e.name?.message}>
                    <Input {...register("name")} placeholder="Acme Corp" />
                  </F>
                </div>
                <F label="Type" error={e.type?.message}>
                  <Controller control={control} name="type" render={({ field }) => (
                    <Select onValueChange={field.onChange} value={field.value}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="prospect">Prospect</SelectItem>
                        <SelectItem value="customer">Customer</SelectItem>
                        <SelectItem value="partner">Partner</SelectItem>
                        <SelectItem value="vendor">Vendor</SelectItem>
                      </SelectContent>
                    </Select>
                  )} />
                </F>
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
                <F label="Industry" error={e.industry?.message}>
                  <Input {...register("industry")} placeholder="Technology" />
                </F>
                <F label="Employees" error={e.employeeCount?.message}>
                  <Input {...register("employeeCount")} type="number" min={0} placeholder="0" />
                </F>
                <F label="Annual Revenue (€)" error={e.annualRevenue?.message}>
                  <Input {...register("annualRevenue")} type="number" min={0} placeholder="0" />
                </F>
                <F label="Website" error={e.website?.message}>
                  <Input {...register("website")} placeholder="https://acme.com" />
                </F>
                <F label="Phone" error={e.mainPhone?.message}>
                  <Input {...register("mainPhone")} type="tel" placeholder="+39 02 1234567" />
                </F>
                <F label="Email" error={e.mainEmail?.message}>
                  <Input {...register("mainEmail")} type="email" placeholder="info@acme.com" />
                </F>
                <F label="LinkedIn URL" error={e.linkedinUrl?.message}>
                  <Input {...register("linkedinUrl")} placeholder="https://linkedin.com/company/…" />
                </F>
                <div className="col-span-2">
                  <F label="Description" error={e.description?.message}>
                    <Textarea {...register("description")} placeholder="Brief description of the company…" className="min-h-[80px] resize-y" />
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
                <div className="col-span-2">
                  <F label="Tags (comma-separated)" error={e.tags?.message}>
                    <Input {...register("tags")} placeholder="tech, enterprise, key-account" />
                  </F>
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

              {/* ── Billing Tab ──────────────────────────────────────────── */}
              <TabsContent value="billing" className="grid grid-cols-2 gap-x-4 gap-y-4 mt-0">
                <F label="VAT Number" error={e.vatNumber?.message}>
                  <Input {...register("vatNumber")} placeholder="IT01234567890" />
                </F>
                <F label="SDI Code" error={e.sdiCode?.message}>
                  <Input {...register("sdiCode")} placeholder="XXXXXXX" />
                </F>
                <div className="col-span-2 rounded-md border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
                  <p className="font-medium text-foreground mb-1">Italian e-invoicing</p>
                  <p>The <strong>SDI Code</strong> (Codice Destinatario) is the 7-character code used for electronic invoice routing via the Sistema di Interscambio.</p>
                </div>
              </TabsContent>
            </Tabs>
          </div>

          <DialogFooter className="px-6 py-4 border-t bg-muted/30">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting} className="min-w-[100px]">
              {isSubmitting && <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />}
              {isEditing ? "Save Changes" : "Create Company"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Delete ────────────────────────────────────────────────────────────────────
export function DeleteCompanyButton({ id }: { id: string }) {
  const [isDeleting, setIsDeleting] = useState(false);
  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this company?")) return;
    try {
      setIsDeleting(true);
      await deleteCompany(id);
      toast.success("Company deleted.");
    } catch {
      toast.error("Failed to delete company.");
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

export function CompanyActions({ company }: { company: any }) {
  return (
    <div className="flex items-center gap-2 justify-end">
      <Link href={`/dashboard/companies/${company.id}`}>
        <Button variant="ghost" size="icon"><EyeIcon className="h-4 w-4" /></Button>
      </Link>
      <CompanyModal company={company}>
        <Button variant="ghost" size="icon"><PencilIcon className="h-4 w-4" /></Button>
      </CompanyModal>
      <DeleteCompanyButton id={company.id} />
    </div>
  );
}
