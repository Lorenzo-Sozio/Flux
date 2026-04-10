"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Send, Users, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { sendCampaignAction, getEligibleRecipientCounts } from "@/actions/marketing";

interface Campaign {
  id: string;
  name: string;
  templateId: string | null;
  status: string;
}

interface LaunchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaign: Campaign;
  templateName?: string;
}

export function LaunchDialog({ open, onOpenChange, campaign, templateName }: LaunchDialogProps) {
  const router = useRouter();
  const [recipientType, setRecipientType] = useState<"contacts" | "leads">("contacts");
  const [counts, setCounts] = useState<{ contacts: number; leads: number } | null>(null);
  const [isLoadingCounts, setIsLoadingCounts] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [result, setResult] = useState<{ queued: number; skipped: number } | null>(null);

  useEffect(() => {
    if (!open) {
      setResult(null);
      return;
    }
    setIsLoadingCounts(true);
    getEligibleRecipientCounts()
      .then(setCounts)
      .catch(() => toast.error("Failed to load recipient counts"))
      .finally(() => setIsLoadingCounts(false));
  }, [open]);

  const eligibleCount = counts ? counts[recipientType] : null;
  const hasTemplate = !!campaign.templateId;

  async function handleLaunch() {
    if (!hasTemplate) return;
    setIsSending(true);
    try {
      const res = await sendCampaignAction({ campaignId: campaign.id, recipientType });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      setResult({ queued: res.queued, skipped: res.skipped });
      router.refresh();
    } catch {
      toast.error("Failed to launch campaign");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-4 w-4 text-primary" />
            Launch Campaign
          </DialogTitle>
          <DialogDescription>
            Emails will be queued and sent asynchronously via the email worker.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          /* Success state */
          <div className="py-4 space-y-4">
            <div className="flex flex-col items-center text-center gap-3 py-4">
              <CheckCircle2 className="h-12 w-12 text-green-500" />
              <div>
                <p className="font-semibold text-lg">Campaign Launched!</p>
                <p className="text-sm text-muted-foreground mt-1">
                  <span className="font-medium text-foreground">{result.queued}</span> emails queued for delivery
                  {result.skipped > 0 && (
                    <>, <span className="font-medium">{result.skipped}</span> skipped (no email / suppressed)</>
                  )}
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          /* Config state */
          <div className="space-y-5 pt-1">
            {/* Campaign summary */}
            <div className="rounded-lg border bg-muted/30 p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Campaign</span>
                <span className="font-medium">{campaign.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Template</span>
                {hasTemplate ? (
                  <span className="font-medium">{templateName ?? "Selected"}</span>
                ) : (
                  <span className="text-destructive font-medium flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Not set
                  </span>
                )}
              </div>
            </div>

            {!hasTemplate && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <p>This campaign has no email template. Edit the campaign to assign one before launching.</p>
              </div>
            )}

            <Separator />

            {/* Recipient type */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Audience</span>
              </div>
              <Select
                value={recipientType}
                onValueChange={(v) => setRecipientType(v as "contacts" | "leads")}
                disabled={!hasTemplate}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="contacts">Contacts (with marketing consent)</SelectItem>
                  <SelectItem value="leads">Leads (unconverted, with consent)</SelectItem>
                </SelectContent>
              </Select>

              <div className="flex items-center justify-between rounded-md border px-3 py-2 bg-muted/20">
                <span className="text-sm text-muted-foreground">Eligible recipients</span>
                {isLoadingCounts ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : (
                  <Badge variant={eligibleCount === 0 ? "destructive" : "secondary"}>
                    {eligibleCount ?? "—"}
                  </Badge>
                )}
              </div>

              {eligibleCount === 0 && !isLoadingCounts && (
                <p className="text-xs text-muted-foreground">
                  No eligible recipients. Make sure contacts/leads have marketing consent and a valid email address.
                </p>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleLaunch}
                disabled={isSending || !hasTemplate || eligibleCount === 0 || isLoadingCounts}
              >
                {isSending ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Launching…</>
                ) : (
                  <><Send className="mr-2 h-4 w-4" />Launch</>
                )}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
