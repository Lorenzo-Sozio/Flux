"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { useRouter } from "next/navigation";

import { CheckIcon, ChevronDownIcon, RotateCcwIcon, ThumbsDownIcon, TrophyIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";

import { getLossReasons, loseDeal, updateDeal, updateDealStage } from "@/actions/pipeline";
import { type LossAnswer, type LossReason, LostDealDialog } from "@/components/crm/lost-deal-dialog";
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
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface PathStage {
  id: string;
  name: string;
  color: string | null;
  isWon: boolean | null;
  isLost: boolean | null;
}

/**
 * Where the deal is, and the one control for moving it.
 *
 * The page used to say "Stage: Negotiation" in a line of grey among eight others,
 * and moving the deal meant opening the edit dialog, finding the Pipeline tab and
 * picking from a dropdown — while the board did it with a drag. Here every open
 * stage is a step: the ones behind are ticked, the current one wears its colour,
 * and pressing any other moves the deal there. Winning and losing are separate
 * buttons rather than two more steps, because they end the deal instead of
 * advancing it, and losing has a question to answer first.
 *
 * ⚠️ The outcome goes through the same actions as the board — `updateDealStage`
 * into the won or lost column when the pipeline has one — so a deal closed here
 * and a card dropped there are closed identically: status, closedAt, the loss
 * reason, the webhooks and the automations.
 */
export function DealStagePath({
  dealId,
  dealName,
  status,
  stageId,
  lostAtStageId,
  closedAt,
  stages,
  canWrite,
}: {
  dealId: string;
  dealName: string;
  status: string;
  stageId: string | null;
  lostAtStageId: string | null;
  closedAt: Date | null;
  stages: PathStage[];
  canWrite: boolean;
}) {
  const t = useTranslations("pipeline.detail");
  const format = useFormatter();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // The step pressed, shown as current at once: a server round trip plus a
  // refresh is long enough for a second press on the step that has not moved.
  const [optimisticStage, setOptimisticStage] = useState<string | null>(null);
  const [confirmWon, setConfirmWon] = useState(false);
  const [askLoss, setAskLoss] = useState(false);
  const [reasons, setReasons] = useState<LossReason[]>([]);
  const pathRef = useRef<HTMLOListElement>(null);
  const currentRef = useRef<HTMLLIElement>(null);

  const open = stages.filter((s) => !s.isWon && !s.isLost);
  const wonStage = stages.find((s) => s.isWon);
  const lostStage = stages.find((s) => s.isLost);
  const closed = status === "won" || status === "lost";

  // Which open step the deal stands on. A lost deal sits in the lost column, so
  // the path shows where the conversation stopped; a won one went through them all.
  const shownStageId =
    optimisticStage ?? (status === "lost" ? lostAtStageId : status === "won" ? open.at(-1)?.id : stageId);
  const currentIndex = open.findIndex((s) => s.id === shownStageId);

  // On a phone the path scrolls sideways; the current step starts in view rather
  // than off the right-hand edge where nobody would think to look for it.
  // ⚠️ Not `scrollIntoView`, which also scrolls every ancestor — the page among
  // them — to bring the step into view, and would move the whole screen on load.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when the step changes
  useEffect(() => {
    const path = pathRef.current;
    const step = currentRef.current;
    if (!path || !step) return;
    path.scrollLeft = step.offsetLeft - (path.clientWidth - step.offsetWidth) / 2;
  }, [currentIndex]);

  // Loaded when first needed: most visits to a deal never lose it.
  useEffect(() => {
    if (!askLoss || reasons.length > 0) return;
    getLossReasons()
      .then((rows) => setReasons(rows.map((r) => ({ id: r.id, name: r.name }))))
      .catch(() => setReasons([]));
  }, [askLoss, reasons.length]);

  const run = (work: () => Promise<unknown>, success: string, optimistic?: string) => {
    if (optimistic) setOptimisticStage(optimistic);
    startTransition(async () => {
      try {
        await work();
        toast.success(success);
        router.refresh();
      } catch {
        toast.error(t("moveFailed"));
      } finally {
        setOptimisticStage(null);
      }
    });
  };

  const moveTo = (stage: PathStage) => {
    if (!canWrite || pending || closed || stage.id === shownStageId) return;
    run(() => updateDealStage(dealId, stage.id), t("stageMoved", { stage: stage.name }), stage.id);
  };

  const markWon = () => {
    setConfirmWon(false);
    run(
      () => (wonStage ? updateDealStage(dealId, wonStage.id) : updateDeal(dealId, { status: "won" })),
      t("markedWon"),
    );
  };

  const markLost = async (answer: LossAnswer) => {
    setAskLoss(false);
    run(() => (lostStage ? updateDealStage(dealId, lostStage.id, answer) : loseDeal(dealId, answer)), t("markedLost"));
  };

  // Back to where it stood: the stage a lost deal stopped at, the last open one
  // for a won deal. A pipeline with no open stage left can still reopen the status.
  const reopen = () => {
    const back = open.find((s) => s.id === lostAtStageId) ?? open.at(-1);
    run(
      () => (back ? updateDealStage(dealId, back.id) : updateDeal(dealId, { status: "open" })),
      t("reopened"),
      back?.id,
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">{t("stagePathLabel")}</h2>
        {currentIndex >= 0 && !closed && (
          <span className="text-muted-foreground text-xs tabular-nums">
            {t("stepOf", { current: currentIndex + 1, total: open.length })}
          </span>
        )}
      </div>

      {open.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("noStages")}</p>
      ) : (
        <>
          {/*
            ⚠️ On a phone the path is a bar and a menu, not a row of steps. The
            steps are ~120px each, so a pipeline of five scrolled sideways inside
            the card and hid where the deal was going; the bar shows the whole
            pipeline at once, the name says where it stands, and "Change stage"
            lists every stage as a row a thumb can hit.
          */}
          <div className="space-y-2.5 sm:hidden">
            <div className="flex gap-1" aria-hidden>
              {open.map((stage, i) => (
                <span
                  key={stage.id}
                  className={cn(
                    "h-1.5 flex-1 rounded-full",
                    i === currentIndex
                      ? ""
                      : currentIndex >= 0 && i < currentIndex
                        ? "bg-primary/60"
                        : "bg-muted-foreground/20",
                  )}
                  style={i === currentIndex ? { backgroundColor: stage.color ?? "var(--primary)" } : undefined}
                />
              ))}
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2 font-semibold text-sm">
                {currentIndex >= 0 && (
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: open[currentIndex].color ?? "var(--primary)" }}
                    aria-hidden
                  />
                )}
                <span className="truncate">{currentIndex >= 0 ? open[currentIndex].name : "—"}</span>
              </span>
              {canWrite && !closed && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline" className="h-10 shrink-0" disabled={pending}>
                      {t("changeStage")}
                      <ChevronDownIcon className="size-4" aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-60">
                    <DropdownMenuRadioGroup
                      value={shownStageId ?? ""}
                      onValueChange={(id) => {
                        const stage = open.find((s) => s.id === id);
                        if (stage) moveTo(stage);
                      }}
                    >
                      {open.map((stage, i) => (
                        <DropdownMenuRadioItem key={stage.id} value={stage.id} className="min-h-11">
                          <span className="text-muted-foreground text-xs tabular-nums">{i + 1}</span>
                          {stage.name}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>

          {/* ⚠️ From sm up it scrolls inside itself, never the page: `min-w-0` on
              every ancestor up to the card is what lets `overflow-x-auto` here do
              its job instead of widening the card. */}
          <ol
            ref={pathRef}
            aria-label={t("stagePathLabel")}
            className="relative -mx-1 flex snap-x gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:thin] max-sm:hidden"
          >
            {open.map((stage, i) => {
              const isCurrent = i === currentIndex;
              const isDone = currentIndex >= 0 && i < currentIndex;
              const colour = stage.color ?? "var(--primary)";
              const interactive = canWrite && !closed && !isCurrent;
              return (
                <li
                  key={stage.id}
                  ref={isCurrent ? currentRef : undefined}
                  className="min-w-[7.5rem] flex-1 snap-start"
                >
                  <button
                    type="button"
                    onClick={() => moveTo(stage)}
                    disabled={!interactive || pending}
                    aria-current={isCurrent ? "step" : undefined}
                    aria-label={isCurrent ? stage.name : t("moveToStage", { stage: stage.name })}
                    title={isCurrent ? stage.name : t("moveToStage", { stage: stage.name })}
                    className={cn(
                      "group flex w-full flex-col gap-1.5 rounded-md p-1.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                      interactive && "hover:bg-muted",
                      // Disabled because it is the current step or because nothing may
                      // move: neither is "unavailable", so neither is greyed out.
                      "disabled:cursor-default",
                    )}
                  >
                    <span
                      className={cn(
                        "h-1.5 w-full rounded-full transition-colors",
                        !isCurrent && !isDone && "bg-muted-foreground/20",
                        isDone && "bg-primary/60",
                      )}
                      style={isCurrent ? { backgroundColor: colour } : undefined}
                      aria-hidden
                    />
                    <span className="flex min-w-0 items-center gap-1.5 text-xs">
                      {isDone ? (
                        <CheckIcon className="size-4 shrink-0 text-primary" aria-hidden />
                      ) : (
                        // The stage colour as a ring, not a fill: stages are coloured by
                        // whoever set up the pipeline, and white on their yellow is unreadable.
                        <span
                          className={cn(
                            "flex size-4 shrink-0 items-center justify-center rounded-full font-semibold text-[9px] tabular-nums",
                            isCurrent ? "border-2 text-foreground" : "bg-muted text-muted-foreground",
                          )}
                          style={isCurrent ? { borderColor: colour } : undefined}
                          aria-hidden
                        >
                          {i + 1}
                        </span>
                      )}
                      <span
                        className={cn(
                          "truncate",
                          isCurrent ? "font-semibold text-foreground" : "text-muted-foreground",
                          interactive && "group-hover:text-foreground",
                        )}
                      >
                        {stage.name}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </>
      )}

      {closed ? (
        <div
          className={cn(
            "flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2.5",
            status === "won"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
              : "border-destructive/30 bg-destructive/10 text-destructive",
          )}
        >
          <span className="flex min-w-0 items-center gap-2 font-medium text-sm">
            {status === "won" ? (
              <TrophyIcon className="size-4 shrink-0" aria-hidden />
            ) : (
              <ThumbsDownIcon className="size-4 shrink-0" aria-hidden />
            )}
            {closedAt
              ? t(status === "won" ? "wonOn" : "lostOn", {
                  date: format.dateTime(new Date(closedAt), { day: "numeric", month: "long", year: "numeric" }),
                })
              : t(status === "won" ? "closedWon" : "closedLost")}
          </span>
          {canWrite && (
            <Button size="sm" variant="outline" className="bg-background" onClick={reopen} disabled={pending}>
              <RotateCcwIcon className="size-3.5" aria-hidden />
              {t("reopen")}
            </Button>
          )}
        </div>
      ) : (
        canWrite && (
          // Below sm the two outcomes are a pair of equal buttons across the card:
          // a thumb's width each, not two pills to aim at on the right.
          <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
            <Button
              size="sm"
              variant="outline"
              className="border-emerald-600/40 text-emerald-700 hover:bg-emerald-500/10 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300"
              onClick={() => setConfirmWon(true)}
              disabled={pending}
            >
              <TrophyIcon className="size-3.5" aria-hidden />
              {t("markWon")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setAskLoss(true)}
              disabled={pending}
            >
              <ThumbsDownIcon className="size-3.5" aria-hidden />
              {t("markLost")}
            </Button>
          </div>
        )
      )}

      {/* Winning fires deal.won to every integration and runs the automations:
          not something a stray tap on a phone should do on its own. */}
      <AlertDialog open={confirmWon} onOpenChange={setConfirmWon}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("wonTitle", { name: dealName })}</AlertDialogTitle>
            <AlertDialogDescription>{t("wonDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={markWon}>{t("markWon")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <LostDealDialog
        open={askLoss}
        dealName={dealName}
        reasons={reasons}
        onCancel={() => setAskLoss(false)}
        onConfirm={markLost}
      />
    </div>
  );
}
