"use client";

import { useEffect, useState, useTransition } from "react";

import { useRouter } from "next/navigation";

import { ActivityIcon, ArrowRightIcon, BuildingIcon, CheckSquareIcon, Loader2Icon, UserIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { convertLead } from "@/actions/crm";
import { getPipelines } from "@/actions/pipeline";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";

export interface ConvertLeadTarget {
  id: string;
  name: string;
  companyName?: string | null;
}

/**
 * Converting a lead: what it becomes, which pipeline the deal opens in, and — for a person
 * with no company — whether they are a private customer (S4).
 *
 * One dialog for the lead's page and the list's row: they were two copies, and a choice added
 * to one would have been missing from the other.
 */
export function ConvertLeadDialog({
  lead,
  trigger,
  activityCount = 0,
  taskCount = 0,
}: {
  lead: ConvertLeadTarget;
  trigger: React.ReactNode;
  activityCount?: number;
  taskCount?: number;
}) {
  const t = useTranslations("leads");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [shouldCreateDeal, setShouldCreateDeal] = useState(true);
  // A person with no company is a private customer unless said otherwise: a quote and an
  // invoice need a company to be made out to, and a residential customer has none.
  const [privateCustomer, setPrivateCustomer] = useState(!lead.companyName);
  const [pipelines, setPipelines] = useState<{ id: string; name: string }[]>([]);
  const [pipelineId, setPipelineId] = useState<string>("");
  const [isPending, startTransition] = useTransition();

  // The pipelines are read when the dialog opens, never with the page.
  useEffect(() => {
    if (!open || pipelines.length > 0) return;
    getPipelines()
      .then((rows) => {
        setPipelines(rows);
        setPipelineId((current) => current || rows[0]?.id || "");
      })
      .catch(() => undefined);
  }, [open, pipelines.length]);

  const handleConvert = () => {
    startTransition(async () => {
      try {
        const result = await convertLead(lead.id, shouldCreateDeal, {
          pipelineId: pipelineId || null,
          privateCustomer: !lead.companyName && privateCustomer,
        });
        toast.success(t("convertSuccessToast"));
        setOpen(false);
        router.push(result.dealId ? `/dashboard/pipeline/${result.dealId}` : `/dashboard/contacts/${result.contactId}`);
      } catch {
        toast.error(t("convertErrorToast"));
      }
    });
  };

  const companyLine = lead.companyName ?? (privateCustomer ? lead.name : null);
  const hasHistory = activityCount > 0 || taskCount > 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>

      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("convertLead")}</DialogTitle>
          <DialogDescription>{t("convert.description")}</DialogDescription>
        </DialogHeader>

        {/* What will be created */}
        <div className="space-y-2 rounded-lg border bg-muted/30 p-3 text-sm">
          <p className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">
            {t("convert.willCreate")}
          </p>
          <div className="flex items-center gap-2">
            <UserIcon className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
            <span>
              {t.rich("convert.contactLine", {
                name: lead.name,
                b: (chunks) => <span className="font-medium">{chunks}</span>,
              })}
            </span>
          </div>
          {companyLine && (
            <div className="flex items-center gap-2">
              <BuildingIcon className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
              <span>
                {t.rich(lead.companyName ? "convert.companyLine" : "convert.privateCompanyLine", {
                  name: companyLine,
                  b: (chunks) => <span className="font-medium">{chunks}</span>,
                })}
              </span>
            </div>
          )}
        </div>

        {/* History migration notice */}
        {hasHistory && (
          <div className="space-y-1.5 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm dark:border-blue-800 dark:bg-blue-950/30">
            <p className="font-semibold text-blue-600 text-xs uppercase tracking-wider dark:text-blue-400">
              {t("convert.historyMigrated")}
            </p>
            {activityCount > 0 && (
              <div className="flex items-center gap-2 text-blue-700 dark:text-blue-300">
                <ActivityIcon className="h-3.5 w-3.5 flex-shrink-0" />
                <span>{t("convert.activityCount", { count: activityCount })}</span>
              </div>
            )}
            {taskCount > 0 && (
              <div className="flex items-center gap-2 text-blue-700 dark:text-blue-300">
                <CheckSquareIcon className="h-3.5 w-3.5 flex-shrink-0" />
                <span>{t("convert.taskCount", { count: taskCount })}</span>
              </div>
            )}
          </div>
        )}

        <Separator />

        {!lead.companyName && (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 space-y-0.5">
              <Label htmlFor={`private-${lead.id}`} className="font-medium text-sm">
                {t("convert.privateCustomer")}
              </Label>
              <p className="text-muted-foreground text-xs">{t("convert.privateCustomerHint")}</p>
            </div>
            <Switch
              id={`private-${lead.id}`}
              checked={privateCustomer}
              onCheckedChange={setPrivateCustomer}
              disabled={isPending}
            />
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 space-y-0.5">
            <Label htmlFor={`deal-${lead.id}`} className="font-medium text-sm">
              {t("convertCreateDeal")}
            </Label>
            <p className="text-muted-foreground text-xs">{t("convert.createDealHint")}</p>
          </div>
          <Switch
            id={`deal-${lead.id}`}
            checked={shouldCreateDeal}
            onCheckedChange={setShouldCreateDeal}
            disabled={isPending}
          />
        </div>

        {/* Which pipeline: asked only where there is a choice. */}
        {shouldCreateDeal && pipelines.length > 1 && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`pipeline-${lead.id}`} className="font-medium text-sm">
              {t("convert.pipeline")}
            </Label>
            <Select value={pipelineId} onValueChange={setPipelineId} disabled={isPending}>
              <SelectTrigger id={`pipeline-${lead.id}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pipelines.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

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
