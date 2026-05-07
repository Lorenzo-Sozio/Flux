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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Eye,
  Loader2,
  MousePointerClick,
  Send,
  ShieldCheck,
  Users,
  AlertTriangle,
  CheckCircle2,
  CalendarClock,
  Clock,
} from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { sendCampaignAction, getEligibleRecipientCounts, scheduleCampaignAction } from "@/actions/marketing";
import { format, addMinutes } from "date-fns";

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

function toLocalDatetimeValue(d: Date) {
  // Format to "YYYY-MM-DDTHH:mm" in local time for datetime-local input
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function LaunchDialog({ open, onOpenChange, campaign, templateName }: LaunchDialogProps) {
  const router = useRouter();
  const [mode, setMode] = useState<"now" | "schedule">("now");
  const [recipientType, setRecipientType] = useState<"contacts" | "leads">("contacts");
  const [scheduledAt, setScheduledAt] = useState(() => toLocalDatetimeValue(addMinutes(new Date(), 30)));
  const [counts, setCounts] = useState<{ contacts: number; leads: number } | null>(null);
  const [isLoadingCounts, setIsLoadingCounts] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<
    | { type: "sent"; queued: number; skipped: number }
    | { type: "scheduled"; scheduledAt: Date }
    | null
  >(null);

  useEffect(() => {
    if (!open) {
      setResult(null);
      setMode("now");
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

  async function handleSubmit() {
    if (!hasTemplate) return;
    setIsSubmitting(true);
    try {
      if (mode === "now") {
        const res = await sendCampaignAction({ campaignId: campaign.id, recipientType });
        if ("error" in res) { toast.error(res.error); return; }
        setResult({ type: "sent", queued: res.queued, skipped: res.skipped });
      } else {
        const date = new Date(scheduledAt);
        if (Number.isNaN(date.getTime())) { toast.error("Invalid date/time"); return; }
        await scheduleCampaignAction({ campaignId: campaign.id, recipientType, scheduledAt: date });
        setResult({ type: "scheduled", scheduledAt: date });
      }
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to launch campaign");
    } finally {
      setIsSubmitting(false);
    }
  }

  const minDatetime = toLocalDatetimeValue(addMinutes(new Date(), 5));
  const canSubmit = hasTemplate && !isLoadingCounts && (eligibleCount ?? 0) > 0 &&
    (mode === "now" || scheduledAt >= minDatetime);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-4 w-4 text-primary" />
            Launch Campaign
          </DialogTitle>
          <DialogDescription>
            Emails are queued and sent asynchronously via the email worker.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="py-4 space-y-4">
            <div className="flex flex-col items-center text-center gap-3 py-4">
              <CheckCircle2 className="h-12 w-12 text-green-500" />
              {result.type === "sent" ? (
                <div>
                  <p className="font-semibold text-lg">Campaign Launched!</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    <span className="font-medium text-foreground">{result.queued}</span> emails queued for delivery
                    {result.skipped > 0 && (
                      <>, <span className="font-medium">{result.skipped}</span> skipped (no email / suppressed)</>
                    )}
                  </p>
                </div>
              ) : (
                <div>
                  <p className="font-semibold text-lg">Campaign Scheduled!</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Will send on{" "}
                    <span className="font-medium text-foreground">
                      {format(result.scheduledAt, "MMM d, yyyy 'at' HH:mm")}
                    </span>
                  </p>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
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
                    <AlertTriangle className="h-3.5 w-3.5" /> Not set
                  </span>
                )}
              </div>
            </div>

            {!hasTemplate && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <p>No email template assigned. Edit the campaign to add one before launching.</p>
              </div>
            )}

            <Separator />

            {/* Audience */}
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
                  No eligible recipients. Make sure contacts/leads have marketing consent and a valid email.
                </p>
              )}
            </div>

            <Separator />

            {/* Send mode */}
            <div className="space-y-3">
              <Tabs value={mode} onValueChange={(v) => setMode(v as "now" | "schedule")}>
                <TabsList className="w-full">
                  <TabsTrigger value="now" className="flex-1 gap-1.5">
                    <Send className="h-3.5 w-3.5" /> Send Now
                  </TabsTrigger>
                  <TabsTrigger value="schedule" className="flex-1 gap-1.5">
                    <CalendarClock className="h-3.5 w-3.5" /> Schedule
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              {mode === "schedule" && (
                <div className="space-y-2">
                  <label className="text-sm font-medium flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                    Send date &amp; time
                  </label>
                  <input
                    type="datetime-local"
                    value={scheduledAt}
                    min={minDatetime}
                    onChange={(e) => setScheduledAt(e.target.value)}
                    className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <p className="text-xs text-muted-foreground">
                    Time is in your local timezone. The scheduler checks every 5 minutes.
                  </p>
                </div>
              )}
            </div>

            {/* Tracking notice */}
            <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-800 px-3 py-2.5 text-xs text-emerald-800 dark:text-emerald-300">
              <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                <span className="font-semibold">Tracking enabled —</span> open and click tracking is automatically applied.
                <div className="flex gap-3 mt-1.5 text-[11px] font-medium opacity-80">
                  <span className="flex items-center gap-1"><Eye className="h-3 w-3" />Open tracking</span>
                  <span className="flex items-center gap-1"><MousePointerClick className="h-3 w-3" />Click tracking</span>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={handleSubmit} disabled={isSubmitting || !canSubmit}>
                {isSubmitting ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{mode === "now" ? "Launching…" : "Scheduling…"}</>
                ) : mode === "now" ? (
                  <><Send className="mr-2 h-4 w-4" />Launch</>
                ) : (
                  <><CalendarClock className="mr-2 h-4 w-4" />Schedule</>
                )}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
