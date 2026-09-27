"use client";

import { useState, useTransition } from "react";

import { useRouter } from "next/navigation";

import { Copy, Loader2, MoreHorizontal, Pencil, Send, Trash2, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { cancelScheduledCampaignAction, deleteMarketingCampaign, duplicateCampaignAction } from "@/actions/marketing";
import { CampaignModal } from "@/components/crm/campaign-modal";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { LaunchDialog } from "../../_components/launch-dialog";

interface Props {
  campaign: {
    id: string;
    name: string;
    description: string | null;
    status: string;
    templateId: string | null;
  };
  templates: { id: string; name: string; subject: string; category: string }[];
  templateName?: string;
}

/**
 * The hero's actions: launch (or cancel the schedule), edit, and a "More" menu
 * for the rarer duplicate and delete.
 *
 * ⚠️ Every action here refreshes the router itself. The server actions revalidate
 * `/dashboard/marketing/campaigns` — the list — and not this page, so without the
 * refresh an edit or a cancelled schedule saved and the screen went on showing
 * the old name and the old status.
 *
 * Returned as a fragment on purpose: the hero lays its direct children out one
 * thumb-width each on a phone, and a wrapper would make the three buttons one.
 * The dialogs render nothing in place (their content is portalled), so they do
 * not take a slot in that row.
 */
export function CampaignActions({ campaign, templates, templateName }: Props) {
  const t = useTranslations("marketing.campaigns");
  const tc = useTranslations("common");
  const tR = useTranslations("record");
  const router = useRouter();
  const [launchOpen, setLaunchOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const cancelSchedule = () =>
    startTransition(async () => {
      try {
        await cancelScheduledCampaignAction(campaign.id);
        toast.success(t("scheduleCancelledToast"));
        router.refresh();
      } catch {
        toast.error(t("scheduleCancelFailed"));
      }
    });

  const duplicate = () =>
    startTransition(async () => {
      try {
        const copy = await duplicateCampaignAction(campaign.id);
        toast.success(t("duplicatedToast"));
        // To the copy: duplicating is almost always the first step of editing it.
        router.push(`/dashboard/marketing/campaigns/${copy.id}`);
      } catch {
        toast.error(t("duplicateFailedToast"));
      }
    });

  const remove = () =>
    startTransition(async () => {
      try {
        await deleteMarketingCampaign(campaign.id);
        toast.success(t("deletedToast"));
        router.replace("/dashboard/marketing/campaigns");
      } catch {
        toast.error(t("deleteFailedToast"));
        setDeleteOpen(false);
      }
    });

  return (
    <>
      {campaign.status === "scheduled" ? (
        <Button size="sm" variant="outline" disabled={isPending} onClick={cancelSchedule}>
          <XCircle className="size-3.5" aria-hidden />
          {t("cancelSchedule")}
        </Button>
      ) : (
        <Button size="sm" disabled={campaign.status === "completed" || isPending} onClick={() => setLaunchOpen(true)}>
          <Send className="size-3.5" aria-hidden />
          {campaign.status === "active" ? t("relaunch") : t("launchBtn")}
        </Button>
      )}

      <CampaignModal
        templates={templates}
        campaign={{
          id: campaign.id,
          name: campaign.name,
          description: campaign.description ?? undefined,
          status: campaign.status,
          templateId: campaign.templateId ?? undefined,
        }}
        onSuccess={() => router.refresh()}
      >
        <Button size="sm" variant="outline">
          <Pencil className="size-3.5" aria-hidden />
          {tR("edit")}
        </Button>
      </CampaignModal>

      {/* Only actions that open nothing of their own live in the menu; delete
          opens its confirmation from outside it, so the menu closing does not
          take the dialog with it. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" disabled={isPending}>
            <MoreHorizontal className="size-3.5" aria-hidden />
            {tR("more")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={duplicate} disabled={isPending} className="min-h-10 md:min-h-0">
            <Copy className="mr-2 size-4" aria-hidden />
            {t("duplicate")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="min-h-10 text-destructive focus:text-destructive md:min-h-0"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="mr-2 size-4" aria-hidden />
            {tc("delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {launchOpen && (
        <LaunchDialog open={launchOpen} onOpenChange={setLaunchOpen} campaign={campaign} templateName={templateName} />
      )}

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.rich("list.deleteConfirmDesc", {
                name: campaign.name,
                strong: (chunks) => <strong>{chunks}</strong>,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                // Kept open until the delete answers, so a failure is not a dialog
                // that closed as though it had worked.
                e.preventDefault();
                remove();
              }}
              disabled={isPending}
            >
              {isPending && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />}
              {tc("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
