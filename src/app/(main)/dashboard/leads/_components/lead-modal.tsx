"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2Icon, PencilIcon, TrashIcon } from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { createLead, deleteLead, updateLead } from "@/actions/crm";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const leadSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email().optional().or(z.literal("")),
  companyName: z.string().optional(),
  status: z.string().default("new"),
  leadScore: z.coerce.number().optional().nullable(),
  marketingConsent: z.boolean().default(false),
  tags: z.string().optional(),
});

type LeadFormValues = z.infer<typeof leadSchema>;

export function LeadModal({ lead, children }: { lead?: any; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const isEditing = !!lead;
  const searchParams = useSearchParams();
  useEffect(() => {
    if (!isEditing && searchParams?.get("new") === "true") {
      setOpen(true);
    }
  }, [isEditing, searchParams]);

  const form = useForm<LeadFormValues>({
    resolver: zodResolver(leadSchema),
    defaultValues: {
      firstName: lead?.firstName || "",
      lastName: lead?.lastName || "",
      email: lead?.email || "",
      companyName: lead?.companyName || "",
      status: lead?.status || "new",
      leadScore: lead?.leadScore || 0,
      marketingConsent: lead?.marketingConsent || false,
      tags: lead?.tags ? lead.tags.join(", ") : "",
    },
  });

  const onSubmit = async (data: LeadFormValues) => {
    try {
      if (isEditing) {
        await updateLead(lead.id, data);
        toast.success("Lead updated successfully!");
      } else {
        await createLead(data);
        toast.success("Lead created successfully!");
      }
      setOpen(false);
      form.reset();
    } catch (error) {
      toast.error("Failed to save lead.");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) form.reset();
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Lead" : "Add Lead"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <Controller
              control={form.control}
              name="firstName"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel>First Name</FieldLabel>
                  <Input {...field} placeholder="Jane" aria-invalid={fieldState.invalid} />
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="lastName"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel>Last Name</FieldLabel>
                  <Input {...field} placeholder="Doe" aria-invalid={fieldState.invalid} />
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />
          </div>
          <Controller
            control={form.control}
            name="email"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel>Email</FieldLabel>
                <Input {...field} type="email" placeholder="jane@example.com" aria-invalid={fieldState.invalid} />
                {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
              </Field>
            )}
          />
          <Controller
            control={form.control}
            name="companyName"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel>Company Name</FieldLabel>
                <Input {...field} placeholder="Acme Corp" aria-invalid={fieldState.invalid} />
                {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
              </Field>
            )}
          />
          <div className="grid grid-cols-2 gap-4">
            <Controller
              control={form.control}
              name="status"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel>Status</FieldLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <SelectTrigger aria-invalid={fieldState.invalid}>
                      <SelectValue placeholder="Select a status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new">New</SelectItem>
                      <SelectItem value="contacting">Contacting</SelectItem>
                      <SelectItem value="engaged">Engaged</SelectItem>
                      <SelectItem value="qualified">Qualified</SelectItem>
                      <SelectItem value="unqualified">Unqualified</SelectItem>
                    </SelectContent>
                  </Select>
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="leadScore"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel>Score</FieldLabel>
                  <Input {...field} type="number" aria-invalid={fieldState.invalid} value={field.value || ""} />
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />
          </div>
          <Controller
            control={form.control}
            name="tags"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel>Tags (comma-separated)</FieldLabel>
                <Input {...field} placeholder="tech, startup, b2b" aria-invalid={fieldState.invalid} />
                {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
              </Field>
            )}
          />
          <Controller
            control={form.control}
            name="marketingConsent"
            render={({ field }) => (
              <div className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                <div className="space-y-0.5">
                  <FieldLabel>Marketing Consent</FieldLabel>
                </div>
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              </div>
            )}
          />
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting && <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteLeadButton({ id }: { id: string }) {
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this lead?")) return;
    try {
      setIsDeleting(true);
      await deleteLead(id);
      toast.success("Lead deleted successfully!");
    } catch (error) {
      toast.error("Failed to delete lead.");
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

export function LeadActions({ lead }: { lead: any }) {
  return (
    <div className="flex items-center gap-2">
      <LeadModal lead={lead}>
        <Button variant="ghost" size="icon">
          <PencilIcon className="h-4 w-4" />
        </Button>
      </LeadModal>
      <DeleteLeadButton id={lead.id} />
    </div>
  );
}
