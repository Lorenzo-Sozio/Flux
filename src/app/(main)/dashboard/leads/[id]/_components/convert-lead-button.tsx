"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Loader2Icon, SparklesIcon } from "lucide-react";
import { toast } from "sonner";

import { convertLead } from "@/actions/crm";
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
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

export function ConvertLeadButton({ leadId }: { leadId: string }) {
  const [open, setOpen] = useState(false);
  const [shouldCreateDeal, setShouldCreateDeal] = useState(true);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleConvert = () => {
    startTransition(async () => {
      try {
        await convertLead(leadId, shouldCreateDeal);
        toast.success("Lead converted successfully!");
        setOpen(false);
        router.push("/dashboard/leads"); // Redirect to leads list
        router.refresh(); // Revalidate the data
      } catch (error) {
        console.error("Failed to convert lead:", error);
        toast.error("Failed to convert lead. Please try again.");
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="flex items-center gap-2" disabled={isPending}>
          {isPending && <Loader2Icon className="h-4 w-4 animate-spin" />}
          <SparklesIcon className="h-4 w-4" />
          Convert Lead
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convert Lead</DialogTitle>
          <DialogDescription>
            Are you sure you want to convert this lead? This will create a new company and contact, and mark the lead as converted.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center space-x-2">
          <Switch
            id="create-deal"
            checked={shouldCreateDeal}
            onCheckedChange={setShouldCreateDeal}
            disabled={isPending}
          />
          <Label htmlFor="create-deal">Create a new Deal/Opportunity</Label>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={isPending}>
              Cancel
            </Button>
          </DialogClose>
          <Button type="button" onClick={handleConvert} disabled={isPending}>
            {isPending && <Loader2Icon className="h-4 w-4 animate-spin" />}
            Confirm Conversion
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
