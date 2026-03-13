"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";
import { PencilIcon, Loader2Icon, PlusIcon } from "lucide-react";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createDeal, updateDeal } from "@/actions/pipeline";

const dealSchema = z.object({
  name: z.string().min(1, "Name is required"),
  amount: z.string().optional(),
  currency: z.string().default("EUR"),
  status: z.string().default("open"),
  stageId: z.string().min(1, "Stage is required"),
  companyId: z.string().optional().nullable(),
  contactId: z.string().optional().nullable(),
});

type DealFormValues = z.infer<typeof dealSchema>;

export function DealModal({ 
  deal, 
  stages, 
  companies, 
  contacts, 
  children 
}: { 
  deal?: any; 
  stages: any[]; 
  companies?: any[];
  contacts?: any[];
  children?: React.ReactNode 
}) {
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isEditing = !!deal;
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!isEditing && searchParams?.get("new") === "true") {
      setOpen(true);
    }
  }, [isEditing, searchParams]);

  const form = useForm<DealFormValues>({
    resolver: zodResolver(dealSchema),
    defaultValues: {
      name: deal?.name || "",
      amount: deal?.amount || "0",
      currency: deal?.currency || "EUR",
      status: deal?.status || "open",
      stageId: deal?.stageId || (stages.length > 0 ? stages[0].id : ""),
      companyId: deal?.companyId || null,
      contactId: deal?.contactId || null,
    },
  });

  const onSubmit = async (data: DealFormValues) => {
    try {
      setIsSubmitting(true);
      if (isEditing) {
        await updateDeal(deal.id, data as any);
        toast.success("Deal updated successfully!");
      } else {
        await createDeal(data as any);
        toast.success("Deal created successfully!");
      }
      setOpen(false);
      if (!isEditing) form.reset();
    } catch (error) {
      toast.error("Failed to save deal.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children || (
          <Button variant="outline" size="icon" className="h-8 w-8">
            <PencilIcon className="h-3.5 w-3.5" />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Deal" : "Create New Deal"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Deal Name</label>
            <Input {...form.register("name")} placeholder="e.g. Q1 Software License" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Amount</label>
              <Input {...form.register("amount")} type="number" placeholder="0.00" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Currency</label>
              <Select 
                onValueChange={(val) => form.setValue("currency", val)} 
                defaultValue={form.getValues("currency")}
              >
                <SelectTrigger><SelectValue placeholder="Currency" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="EUR">EUR (€)</SelectItem>
                  <SelectItem value="USD">USD ($)</SelectItem>
                  <SelectItem value="GBP">GBP (£)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Stage</label>
              <Select 
                onValueChange={(val) => form.setValue("stageId", val)} 
                defaultValue={form.getValues("stageId")}
              >
                <SelectTrigger><SelectValue placeholder="Select stage" /></SelectTrigger>
                <SelectContent>
                  {stages.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Status</label>
              <Select 
                onValueChange={(val) => form.setValue("status", val)} 
                defaultValue={form.getValues("status")}
              >
                <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="won">Won</SelectItem>
                  <SelectItem value="lost">Lost</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
             <div className="space-y-2">
              <label className="text-sm font-medium">Company (Optional)</label>
              <Select 
                onValueChange={(val) => form.setValue("companyId", val === "none" ? null : val)} 
                defaultValue={form.getValues("companyId") || "none"}
              >
                <SelectTrigger><SelectValue placeholder="Link Company" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {companies?.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Contact (Optional)</label>
              <Select 
                onValueChange={(val) => form.setValue("contactId", val === "none" ? null : val)} 
                defaultValue={form.getValues("contactId") || "none"}
              >
                <SelectTrigger><SelectValue placeholder="Link Contact" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {contacts?.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.firstName} {c.lastName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />}
              {isEditing ? "Update Deal" : "Create Deal"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
