"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Zap, Plus, Trash2, Pencil, Eye, AlertCircle, CheckCircle2, Clock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { RuleModal } from "@/components/crm/automation/rule-builder";
import { deleteAutomationRule, toggleAutomationRuleActive } from "@/actions/automation";
import { cn } from "@/lib/utils";

type Rule = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  targetEntity: string;
  triggerOn: string[] | null;
  conditionLogic: string;
  conditions: string;
  actions: string;
  createdAt: Date;
};

interface Props {
  rules: Rule[];
  canEdit: boolean;
}

const ENTITY_META: Record<string, { label: string; color: string }> = {
  deal:    { label: "Deal",    color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  lead:    { label: "Lead",    color: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300" },
  contact: { label: "Contact", color: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" },
  company: { label: "Company", color: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300" },
};

const TRIGGER_META: Record<string, { label: string; icon: React.ReactNode; color: string; description: string }> = {
  onCreate: {
    label: "On Create",
    icon: <Plus className="h-3 w-3" />,
    color: "bg-green-100 text-green-700 dark:bg-green-900/40",
    description: "Runs when a new record is created"
  },
  onUpdate: {
    label: "On Update",
    icon: <Pencil className="h-3 w-3" />,
    color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40",
    description: "Runs when a record is modified"
  },
};

/**
 * Estrae il trigger schedulato se presente
 * Format: "scheduled:0 8 * * *"
 */
function getScheduledTrigger(triggerOn: string[] | null): string | null {
  if (!triggerOn) return null;
  const scheduledTrigger = triggerOn.find((t) => t.startsWith("scheduled:"));
  if (!scheduledTrigger) return null;
  return scheduledTrigger.substring("scheduled:".length);
}

/**
 * Converte cron expression a descrizione leggibile
 */
function formatCronDescription(cronExpr: string): string {
  const parts = cronExpr.split(" ");
  if (parts.length < 5) return cronExpr;

  const minute = parts[0];
  const hour = parts[1];
  const dayOfMonth = parts[2];
  const dayOfWeek = parts[4];

  // Common patterns
  if (dayOfMonth === "*" && dayOfWeek === "*") {
    return `Daily at ${hour}:${minute.padStart(2, "0")}`;
  }
  if (dayOfMonth === "*" && dayOfWeek !== "*") {
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const dayNum = parseInt(dayOfWeek);
    return `Every ${days[dayNum] || "??"} at ${hour}:${minute.padStart(2, "0")}`;
  }
  if (hour === "*/6") return "Every 6 hours";
  if (hour === "*/4") return "Every 4 hours";
  if (hour === "*/2") return "Every 2 hours";
  
  return cronExpr; // Fallback to raw
}

export function AutomationClient({ rules, canEdit }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleToggle = (id: string, current: boolean) => {
    startTransition(async () => {
      await toggleAutomationRuleActive(id, !current);
      router.refresh();
    });
  };

  const handleDelete = (id: string) => {
    startTransition(async () => {
      try {
        await deleteAutomationRule(id);
        toast.success("Rule deleted.");
        router.refresh();
      } catch {
        toast.error("Failed to delete rule.");
      }
    });
  };

  return (
    <div className="space-y-5">

      {/* ── Page Header ───────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-yellow-100 dark:bg-yellow-900/30">
              <Zap className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
            </span>
            Automation Rules
          </h1>
          <p className="text-muted-foreground text-sm mt-1.5">
            Trigger-based rules that run automatically when CRM records change.
          </p>
        </div>
        {canEdit && (
          <RuleModal onSaved={() => router.refresh()}>
            <Button className="gap-2">
              <Plus className="h-4 w-4" /> New Rule
            </Button>
          </RuleModal>
        )}
      </div>

      {/* ── Empty State ───────────────────────────────────────────────── */}
      {rules.length === 0 ? (
        <div className="border-2 border-dashed rounded-xl p-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted mx-auto mb-4">
            <Zap className="h-7 w-7 text-muted-foreground" />
          </div>
          <p className="font-semibold">No automation rules yet</p>
          <p className="text-sm text-muted-foreground mt-1">
            Rules run automatically when records are created or updated.
          </p>
          {canEdit && (
            <RuleModal onSaved={() => router.refresh()}>
              <Button className="mt-5 gap-2">
                <Plus className="h-4 w-4" /> Create your first rule
              </Button>
            </RuleModal>
          )}
        </div>
      ) : (

        /* ── Rule List ────────────────────────────────────────────────── */
        <div className="rounded-xl border overflow-hidden">
          {rules.map((rule, i) => {
            const em = ENTITY_META[rule.targetEntity];
            return (
              <div
                key={rule.id}
                className={`flex items-center gap-4 px-5 py-4 bg-card hover:bg-muted/30 transition-colors ${
                  i < rules.length - 1 ? "border-b" : ""
                }`}
              >
                {/* Status dot */}
                <div className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ring-2 ${
                  rule.isActive
                    ? "bg-green-500 ring-green-200 dark:ring-green-900"
                    : "bg-muted-foreground/30 ring-transparent"
                }`} />

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{rule.name}</span>
                    {em && (
                      <Badge className={`text-[11px] px-2 py-0 h-5 font-medium border-0 ${em.color}`}>
                        {em.label}
                      </Badge>
                    )}
                    
                    {/* Trigger Badges */}
                    {(rule.triggerOn ?? []).map((trigger) => {
                      const meta = TRIGGER_META[trigger];
                      if (!meta) return null;
                      
                      return (
                        <TooltipProvider key={trigger}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge
                                variant="outline"
                                className={cn(
                                  "text-[11px] px-2 py-0 h-5 font-medium border-0 cursor-help gap-1",
                                  meta.color
                                )}
                              >
                                {meta.icon}
                                {meta.label}
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent>{meta.description}</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      );
                    })}
                    
                    {/* Scheduled Trigger Badge */}
                    {getScheduledTrigger(rule.triggerOn) && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge
                              variant="outline"
                              className="text-[11px] px-2 py-0 h-5 font-medium border-0 gap-1 bg-amber-100 text-amber-700 dark:bg-amber-900/40 cursor-help"
                            >
                              <Clock className="h-3 w-3" />
                              Scheduled
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent>
                            {formatCronDescription(getScheduledTrigger(rule.triggerOn)!)}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                    
                    {!rule.isActive && (
                      <Badge variant="outline" className="text-[11px] px-2 py-0 h-5 text-muted-foreground/60">
                        Disabled
                      </Badge>
                    )}
                  </div>
                  {rule.description && (
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{rule.description}</p>
                  )}
                </div>

                {/* Row actions */}
                {canEdit && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Switch
                      checked={rule.isActive}
                      onCheckedChange={() => handleToggle(rule.id, rule.isActive)}
                      disabled={isPending}
                      title={rule.isActive ? "Disable" : "Enable"}
                    />

                    <RuleModal rule={rule} onSaved={() => router.refresh()}>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </RuleModal>

                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete this rule?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This permanently deletes <strong>{rule.name}</strong> and all its execution logs. This action cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-destructive hover:bg-destructive/90"
                            onClick={() => handleDelete(rule.id)}
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
