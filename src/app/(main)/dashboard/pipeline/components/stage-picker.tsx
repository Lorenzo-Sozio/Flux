"use client";

import { Check, Trophy, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";

import { type Stage, stageLabel } from "./pipeline-types";

/**
 * Where a deal goes next, as a list to tap: the move a finger cannot make by dragging.
 *
 * A sheet from the bottom edge on a phone or a tablet, where the thumb is; a small
 * dialog on a desktop. The stages are in their order with the one the deal is in
 * ticked, and winning and losing come last, apart, because they end the deal.
 * What happens after the pick (the loss reason, the next step) is the caller's —
 * the same rules as a drop on the board.
 */
export function StagePicker({
  stages,
  currentStageId,
  dealName,
  open,
  onOpenChange,
  onPick,
  sheet,
}: {
  stages: Stage[];
  currentStageId: string | null;
  dealName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (stageId: string) => void;
  /** A bottom sheet rather than a dialog. */
  sheet: boolean;
}) {
  const t = useTranslations("pipeline.list");
  const working = stages.filter((s) => !s.isWon && !s.isLost);
  const ending = stages.filter((s) => s.isWon || s.isLost);

  const option = (stage: Stage) => {
    const current = stage.id === currentStageId;
    return (
      <button
        key={stage.id}
        type="button"
        aria-current={current || undefined}
        onClick={() => {
          onOpenChange(false);
          if (!current) onPick(stage.id);
        }}
        className={cn(
          "flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
          current && "bg-muted/60 font-semibold",
        )}
      >
        {stage.isWon ? (
          <Trophy className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
        ) : stage.isLost ? (
          <XCircle className="size-4 shrink-0 text-red-600 dark:text-red-400" aria-hidden />
        ) : (
          <span
            className="size-3 shrink-0 rounded-full border"
            style={{ backgroundColor: stage.color ?? undefined }}
            aria-hidden
          />
        )}
        <span className="min-w-0 flex-1 truncate text-sm">{stageLabel(stage)}</span>
        {current && <Check className="size-4 shrink-0 text-primary" aria-hidden />}
      </button>
    );
  };

  const body = (
    <div className="flex flex-col gap-0.5 overflow-y-auto px-2 pb-3">
      {working.map(option)}
      {ending.length > 0 && <div className="mx-3 my-1.5 border-t" />}
      {ending.map(option)}
    </div>
  );

  if (sheet) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="max-h-[85dvh] pb-[var(--safe-bottom)]">
          <DrawerHeader className="text-left">
            <DrawerTitle>{t("moveTitle")}</DrawerTitle>
            <DrawerDescription className="truncate">{dealName}</DrawerDescription>
          </DrawerHeader>
          {body}
        </DrawerContent>
      </Drawer>
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-2 p-0 sm:max-w-sm">
        <DialogHeader className="px-5 pt-5">
          <DialogTitle>{t("moveTitle")}</DialogTitle>
          <DialogDescription className="truncate">{dealName}</DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}
