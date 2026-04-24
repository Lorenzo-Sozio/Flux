"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon, SparklesIcon } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("leads");
  const [open, setOpen] = useState(false);
  const [shouldCreateDeal, setShouldCreateDeal] = useState(true);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleConvert = () => {
    startTransition(async () => {
      try {
        await convertLead(leadId, shouldCreateDeal);
        toast.success(t("convertSuccessToast"));
        setOpen(false);
        router.push("/dashboard/leads");
        router.refresh();
      } catch (error) {
        console.error("Failed to convert lead:", error);
        toast.error(t("convertErrorToast"));
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="flex items-center gap-2" disabled={isPending}>
          {isPending && <Loader2Icon className="h-4 w-4 animate-spin" />}
          <SparklesIcon className="h-4 w-4" />
          {t("convertLead")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("convertLead")}</DialogTitle>
          <DialogDescription>{t("convertLeadDesc")}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center space-x-2">
          <Switch
            id="create-deal"
            checked={shouldCreateDeal}
            onCheckedChange={setShouldCreateDeal}
            disabled={isPending}
          />
          <Label htmlFor="create-deal">{t("convertCreateDeal")}</Label>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={isPending}>
              {t("convertCancel")}
            </Button>
          </DialogClose>
          <Button type="button" onClick={handleConvert} disabled={isPending}>
            {isPending && <Loader2Icon className="h-4 w-4 animate-spin" />}
            {t("convertConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
