"use client";

import { useTransition } from "react";

import { Clock, Pencil, Plus, Trash2, Zap } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { deleteAutomationRule, toggleAutomationRuleActive } from "@/actions/automation";
import { RuleModal } from "@/components/crm/automation/rule-builder";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { RecipeLibrary } from "./recipe-library";

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

const ENTITY_COLORS: Record<string, string> = {
  deal: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  lead: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  contact: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  company: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  ticket: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  order: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
};

const TRIGGER_STYLES: Record<string, { icon: React.ReactNode; color: string }> = {
  onCreate: {
    icon: <Plus className="h-3 w-3" />,
    color: "bg-green-100 text-green-700 dark:bg-green-900/40",
  },
  onUpdate: {
    icon: <Pencil className="h-3 w-3" />,
    color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40",
  },
};

/**
 * Pulls out the scheduled trigger, if there is one.
 * Format: "scheduled:0 8 * * *"
 */
function getScheduledTrigger(triggerOn: string[] | null): string | null {
  if (!triggerOn) return null;
  const scheduledTrigger = triggerOn.find((t) => t.startsWith("scheduled:"));
  if (!scheduledTrigger) return null;
  return scheduledTrigger.substring("scheduled:".length);
}

export function AutomationClient({ rules, canEdit }: Props) {
  const t = useTranslations("automation");
  const tCommon = useTranslations("common");
  const [isPending, startTransition] = useTransition();

  const triggerLabels: Record<string, string> = {
    onCreate: t("triggers.onCreate"),
    onUpdate: t("triggers.onUpdate"),
  };
  const triggerDescs: Record<string, string> = {
    onCreate: t("triggers.onCreateDesc"),
    onUpdate: t("triggers.onUpdateDesc"),
  };

  const handleToggle = (id: string, current: boolean) => {
    startTransition(async () => {
      await toggleAutomationRuleActive(id, !current);
    });
  };

  const handleDelete = (id: string) => {
    startTransition(async () => {
      try {
        await deleteAutomationRule(id);
        toast.success(t("deleteSuccess"));
      } catch {
        toast.error(t("deleteFailed"));
      }
    });
  };

  return (
    <div className="space-y-5">
      {/* ── Page Header ───────────────────────────────────────────────── */}
      {/* Wrapping, not shrinking: the two buttons beside the title pushed past the
          edge of a phone. They drop to their own line there. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2.5 font-bold text-2xl">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-yellow-100 dark:bg-yellow-900/30">
              <Zap className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
            </span>
            {t("title")}
          </h1>
          <p className="mt-1.5 text-muted-foreground text-sm">{t("subtitle")}</p>
        </div>
        {canEdit && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {/* Offered before the empty builder, not after it. */}
            <RecipeLibrary />
            <RuleModal>
              <Button className="gap-2">
                <Plus className="h-4 w-4" /> {t("newRule")}
              </Button>
            </RuleModal>
          </div>
        )}
      </div>

      {/* ── Empty State ───────────────────────────────────────────────── */}
      {rules.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed px-4 py-12 text-center sm:p-16">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-muted">
            <Zap className="h-7 w-7 text-muted-foreground" />
          </div>
          <p className="font-semibold">{t("emptyTitle")}</p>
          <p className="mt-1 text-muted-foreground text-sm">{t("emptyDesc")}</p>
          {canEdit && (
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              <RecipeLibrary />
              <RuleModal>
                <Button className="gap-2">
                  <Plus className="h-4 w-4" /> {t("createFirstRule")}
                </Button>
              </RuleModal>
            </div>
          )}
        </div>
      ) : (
        /* ── Rule List ────────────────────────────────────────────────── */
        <div className="overflow-hidden rounded-xl border">
          {rules.map((rule, i) => {
            const entityColor = ENTITY_COLORS[rule.targetEntity];
            const entityLabel = t(
              `entities.${rule.targetEntity as "deal" | "lead" | "contact" | "company" | "ticket" | "order"}`,
            );
            return (
              <div
                key={rule.id}
                // ⚠️ `flex-wrap` with a full-width action group below `sm`: beside a
                // switch and two buttons the rule's name had 140px and broke one
                // word per line. On a phone the actions take a line of their own.
                className={`flex flex-wrap items-center gap-x-4 gap-y-2 bg-card px-4 py-3 transition-colors hover:bg-muted/30 sm:flex-nowrap sm:px-5 sm:py-4 ${
                  i < rules.length - 1 ? "border-b" : ""
                }`}
              >
                {/* Status dot */}
                <div
                  className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ring-2 ${
                    rule.isActive
                      ? "bg-green-500 ring-green-200 dark:ring-green-900"
                      : "bg-muted-foreground/30 ring-transparent"
                  }`}
                />

                {/* Info */}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-sm">{rule.name}</span>
                    {entityColor && (
                      <Badge className={`h-5 border-0 px-2 py-0 font-medium text-[11px] ${entityColor}`}>
                        {entityLabel}
                      </Badge>
                    )}

                    {/* Trigger Badges */}
                    {(rule.triggerOn ?? []).map((trigger) => {
                      const style = TRIGGER_STYLES[trigger];
                      if (!style) return null;
                      return (
                        <TooltipProvider key={trigger}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge
                                variant="outline"
                                className={cn(
                                  "h-5 cursor-help gap-1 border-0 px-2 py-0 font-medium text-[11px]",
                                  style.color,
                                )}
                              >
                                {style.icon}
                                {triggerLabels[trigger] ?? trigger}
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent>{triggerDescs[trigger]}</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      );
                    })}

                    {/* Scheduled Trigger Badge — says the schedule does not run, because it
                        does not (see the rule builder). */}
                    {getScheduledTrigger(rule.triggerOn) && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge
                              variant="outline"
                              className="h-5 cursor-help gap-1 border-0 bg-amber-100 px-2 py-0 font-medium text-[11px] text-amber-700 dark:bg-amber-900/40"
                            >
                              <Clock className="h-3 w-3" />
                              {t("triggers.scheduledInactive")}
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent>{t("triggers.scheduledInactiveHint")}</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}

                    {!rule.isActive && (
                      <Badge variant="outline" className="h-5 px-2 py-0 text-[11px] text-muted-foreground/60">
                        {t("disabled")}
                      </Badge>
                    )}
                  </div>
                  {rule.description && (
                    <p className="mt-0.5 truncate text-muted-foreground text-xs">{rule.description}</p>
                  )}
                </div>

                {/* Row actions */}
                {canEdit && (
                  <div className="flex w-full flex-shrink-0 items-center justify-end gap-1 sm:w-auto">
                    <Switch
                      checked={rule.isActive}
                      onCheckedChange={() => handleToggle(rule.id, rule.isActive)}
                      disabled={isPending}
                      title={rule.isActive ? tCommon("disable") : tCommon("enable")}
                    />

                    <RuleModal rule={rule}>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-9 text-muted-foreground sm:size-8"
                        aria-label={tCommon("edit")}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </RuleModal>

                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-9 text-muted-foreground hover:text-destructive sm:size-8"
                          aria-label={tCommon("delete")}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>{t("deleteTitle")}</AlertDialogTitle>
                          <AlertDialogDescription>{t("deleteDesc", { name: rule.name })}</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-destructive hover:bg-destructive/90"
                            onClick={() => handleDelete(rule.id)}
                          >
                            {t("deleteRule")}
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
