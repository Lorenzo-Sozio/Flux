"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import {
  TargetIcon,
  Send,
  MoreHorizontal,
  Trash2,
  Copy,
  BarChart2,
  Mail,
  MousePointerClick,
  Eye,
  Loader2,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import { deleteMarketingCampaign, duplicateCampaignAction } from "@/actions/marketing";
import { CampaignModal } from "@/components/crm/campaign-modal";
import { LaunchDialog } from "./launch-dialog";

interface Template {
  id: string;
  name: string;
  subject: string;
  category: string;
}

interface Campaign {
  id: string;
  name: string;
  description: string | null;
  status: string;
  templateId: string | null;
  createdAt: Date;
  stats: {
    total: number;
    sent: number;
    opened: number;
    clicked: number;
    openRate: string;
    clickRate: string;
  };
}

interface Props {
  campaigns: Campaign[];
  templates: Template[];
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  draft:     { label: "Draft",     className: "border-slate-300 text-slate-600" },
  active:    { label: "Active",    className: "border-green-300 text-green-700 bg-green-50" },
  completed: { label: "Completed", className: "border-blue-300 text-blue-700 bg-blue-50" },
};

export function CampaignsClient({ campaigns: initial, templates }: Props) {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState(initial);
  const [launchTarget, setLaunchTarget] = useState<Campaign | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Campaign | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    if (!deleteTarget) return;
    startTransition(async () => {
      try {
        await deleteMarketingCampaign(deleteTarget.id);
        setCampaigns((prev) => prev.filter((c) => c.id !== deleteTarget.id));
        toast.success("Campaign deleted");
      } catch {
        toast.error("Failed to delete campaign");
      } finally {
        setDeleteTarget(null);
      }
    });
  }

  function handleDuplicate(campaign: Campaign) {
    startTransition(async () => {
      try {
        await duplicateCampaignAction(campaign.id);
        toast.success("Campaign duplicated");
        router.refresh();
      } catch {
        toast.error("Failed to duplicate campaign");
      }
    });
  }

  if (campaigns.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center border-2 border-dashed rounded-xl bg-muted/5">
        <TargetIcon className="w-12 h-12 text-muted-foreground/20 mx-auto mb-4" />
        <p className="font-medium text-muted-foreground">No campaigns yet</p>
        <p className="text-sm text-muted-foreground mt-1 mb-5">Create your first campaign to start reaching your audience.</p>
        <CampaignModal templates={templates} onSuccess={() => router.refresh()} />
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {campaigns.map((c) => {
          const statusCfg = STATUS_CONFIG[c.status] ?? STATUS_CONFIG.draft;
          const templateName = templates.find((t) => t.id === c.templateId)?.name;

          return (
            <Card key={c.id} className="flex flex-col overflow-hidden hover:shadow-md transition-shadow border-0 shadow-sm">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <Badge variant="outline" className={`text-xs shrink-0 ${statusCfg.className}`}>
                    {statusCfg.label}
                  </Badge>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <Link href={`/dashboard/marketing/campaigns/${c.id}`}>
                          <BarChart2 className="mr-2 h-4 w-4" />
                          View Stats
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => handleDuplicate(c)} disabled={isPending}>
                        <Copy className="mr-2 h-4 w-4" />
                        Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => setDeleteTarget(c)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <Link href={`/dashboard/marketing/campaigns/${c.id}`} className="group mt-2 block">
                  <CardTitle className="text-base group-hover:text-primary transition-colors line-clamp-1">
                    {c.name}
                  </CardTitle>
                </Link>
                <CardDescription className="line-clamp-2 text-xs min-h-[2rem]">
                  {c.description || "No description."}
                </CardDescription>
                {templateName && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                    <Mail className="h-3 w-3" />
                    {templateName}
                  </p>
                )}
              </CardHeader>

              {/* Stats row */}
              {c.stats.total > 0 && (
                <div className="mx-4 mb-3 grid grid-cols-3 gap-2 rounded-lg bg-muted/40 px-3 py-2 text-center">
                  <div>
                    <p className="text-xs font-semibold tabular-nums">{c.stats.sent}</p>
                    <p className="text-[10px] text-muted-foreground flex items-center justify-center gap-0.5">
                      <Send className="h-2.5 w-2.5" /> Sent
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold tabular-nums">{c.stats.openRate}%</p>
                    <p className="text-[10px] text-muted-foreground flex items-center justify-center gap-0.5">
                      <Eye className="h-2.5 w-2.5" /> Open
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold tabular-nums">{c.stats.clickRate}%</p>
                    <p className="text-[10px] text-muted-foreground flex items-center justify-center gap-0.5">
                      <MousePointerClick className="h-2.5 w-2.5" /> Click
                    </p>
                  </div>
                </div>
              )}

              <CardContent className="pt-0 pb-4 mt-auto border-t bg-muted/5">
                <div className="flex items-center justify-between text-xs text-muted-foreground mb-3 pt-3">
                  <span>{new Date(c.createdAt).toLocaleDateString()}</span>
                  {c.stats.total > 0 && (
                    <span>{c.stats.total} recipients</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <CampaignModal
                    templates={templates}
                    campaign={{ id: c.id, name: c.name, description: c.description ?? undefined, status: c.status, templateId: c.templateId ?? undefined }}
                    onSuccess={() => router.refresh()}
                  />
                  <Button
                    size="sm"
                    className="flex-1 gap-2"
                    disabled={c.status === "completed" || isPending}
                    onClick={() => setLaunchTarget(c)}
                  >
                    <Send className="h-3.5 w-3.5" />
                    {c.status === "active" ? "Re-launch" : "Launch"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Launch Dialog */}
      {launchTarget && (
        <LaunchDialog
          open={!!launchTarget}
          onOpenChange={(o) => !o && setLaunchTarget(null)}
          campaign={launchTarget}
          templateName={templates.find((t) => t.id === launchTarget.templateId)?.name}
        />
      )}

      {/* Delete Confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Campaign</AlertDialogTitle>
            <AlertDialogDescription>
              Delete <strong>{deleteTarget?.name}</strong>? All send logs and tracking data will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
              disabled={isPending}
            >
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
