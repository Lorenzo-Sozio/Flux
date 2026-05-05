"use client";

import { useState, useTransition } from "react";

import { useRouter } from "next/navigation";

import {
  ActivityIcon,
  ArrowRightIcon,
  BuildingIcon,
  CheckSquareIcon,
  Loader2Icon,
  SparklesIcon,
  UserIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
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
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";

interface ConvertLeadButtonProps {
  leadId: string;
  leadName: string;
  companyName?: string | null;
  activityCount: number;
  taskCount: number;
}

export function ConvertLeadButton({ leadId, leadName, companyName, activityCount, taskCount }: ConvertLeadButtonProps) {
  const t = useTranslations("leads");
  const [open, setOpen] = useState(false);
  const [shouldCreateDeal, setShouldCreateDeal] = useState(true);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleConvert = () => {
    startTransition(async () => {
      try {
        const result = await convertLead(leadId, shouldCreateDeal);
        toast.success(t("convertSuccessToast"));
        setOpen(false);
        if (result.dealId) {
          router.push(`/dashboard/pipeline?dealId=${result.dealId}`);
        } else {
          router.push(`/dashboard/contacts?contactId=${result.contactId}`);
        }
      } catch (error) {
        console.error("Failed to convert lead:", error);
        toast.error(t("convertErrorToast"));
      }
    });
  };

  const hasHistory = activityCount > 0 || taskCount > 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="flex items-center gap-2" disabled={isPending}>
          {isPending ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <SparklesIcon className="h-4 w-4" />}
          {t("convertLead")}
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("convertLead")}</DialogTitle>
          <DialogDescription>{t("convertLeadDesc")}</DialogDescription>
        </DialogHeader>

        {/* What will be created */}
        <div className="space-y-2 rounded-lg border bg-muted/30 p-3 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Verrà creato</p>
          <div className="flex items-center gap-2">
            <UserIcon className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            <span>
              Contatto: <span className="font-medium">{leadName}</span>
            </span>
          </div>
          {companyName && (
            <div className="flex items-center gap-2">
              <BuildingIcon className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
              <span>
                Azienda: <span className="font-medium">{companyName}</span>
              </span>
            </div>
          )}
        </div>

        {/* History migration notice */}
        {hasHistory && (
          <div className="space-y-1.5 rounded-lg border bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800 p-3 text-sm">
            <p className="text-xs font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400">
              Storia migrata al nuovo cliente
            </p>
            {activityCount > 0 && (
              <div className="flex items-center gap-2 text-blue-700 dark:text-blue-300">
                <ActivityIcon className="h-3.5 w-3.5 flex-shrink-0" />
                <span>
                  {activityCount} {activityCount === 1 ? "attività" : "attività"}
                </span>
              </div>
            )}
            {taskCount > 0 && (
              <div className="flex items-center gap-2 text-blue-700 dark:text-blue-300">
                <CheckSquareIcon className="h-3.5 w-3.5 flex-shrink-0" />
                <span>
                  {taskCount} {taskCount === 1 ? "task" : "task"}
                </span>
              </div>
            )}
          </div>
        )}

        <Separator />

        {/* Deal toggle */}
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-0.5">
            <Label htmlFor="create-deal" className="text-sm font-medium">
              {t("convertCreateDeal")}
            </Label>
            <p className="text-xs text-muted-foreground">
              Crea un'opportunità nella pipeline collegata a questo cliente
            </p>
          </div>
          <Switch
            id="create-deal"
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
