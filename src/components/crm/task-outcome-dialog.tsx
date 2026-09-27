"use client";

import { useEffect, useState } from "react";

import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { updateTaskStatus } from "@/actions/tasks";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { needsRetry, OUTCOMES, type Outcome, TASK_TYPES, type TaskType, taskTypeOf } from "@/lib/task-kinds";
import { cn } from "@/lib/utils";

export interface OutcomeTask {
  id: string;
  title: string;
  type?: string | null;
}

/** A calendar date in the browser's zone, as `<input type="date">` wants it. */
function dateInput(daysAhead: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const QUICK_DAYS = [
  { key: "tomorrow", days: 1 },
  { key: "in3", days: 3 },
  { key: "nextWeek", days: 7 },
] as const;

/**
 * "How did it go?" — what completing a task asks, in one panel: the outcome, a note, and
 * the next step. Saving records the activity and plans the next task together
 * (updateTaskStatus with a report); every field may stay empty.
 *
 * ⚠️ A call nobody answered proposes another call with the same title, due tomorrow: the
 * work is not finished, and retyping it is the step people skip.
 */
export function TaskOutcomeDialog({
  task,
  open,
  onOpenChange,
  revalidate,
  onCompleted,
}: {
  task: OutcomeTask;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  revalidate?: string;
  onCompleted?: () => void;
}) {
  const t = useTranslations("taskOutcome");
  const tType = useTranslations("taskTypes");
  const type = taskTypeOf(task.type);
  const outcomes = OUTCOMES[type] as readonly Outcome[];

  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [note, setNote] = useState("");
  const [nextType, setNextType] = useState<TaskType>(type);
  const [nextTitle, setNextTitle] = useState("");
  const [nextDate, setNextDate] = useState(dateInput(1));
  const [nextTime, setNextTime] = useState("");
  const [saving, setSaving] = useState(false);

  // A fresh panel each time it opens: the last task's answers are not this one's.
  useEffect(() => {
    if (!open) return;
    setOutcome(outcomes.length === 1 ? outcomes[0] : null);
    setNote("");
    setNextType(type);
    setNextTitle("");
    setNextDate(dateInput(1));
    setNextTime("");
  }, [open, outcomes, type]);

  const pickOutcome = (o: Outcome) => {
    setOutcome(o);
    if (needsRetry(o) && !nextTitle) {
      setNextType(type);
      setNextTitle(task.title);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const title = nextTitle.trim();
      await updateTaskStatus(task.id, "done", revalidate, {
        outcome,
        note,
        next: title
          ? {
              type: nextType,
              title,
              dueDate: nextDate ? new Date(`${nextDate}T${nextTime || "00:00"}`) : null,
              allDay: !nextTime,
            }
          : null,
      });
      toast.success(title ? t("savedWithNext") : t("saved"));
      onOpenChange(false);
      onCompleted?.();
    } catch {
      toast.error(t("failed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription className="break-words">{task.title}</DialogDescription>
        </DialogHeader>

        <form
          id="task-outcome"
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          {outcomes.length > 1 && (
            <fieldset className="space-y-1.5">
              <legend className="mb-1.5 font-medium text-sm">{t("outcomeLabel")}</legend>
              <div className="flex flex-wrap gap-2">
                {outcomes.map((o) => (
                  <Button
                    key={o}
                    type="button"
                    size="sm"
                    variant={outcome === o ? "default" : "outline"}
                    aria-pressed={outcome === o}
                    onClick={() => pickOutcome(o)}
                  >
                    {t(`outcomes.${o}`)}
                  </Button>
                ))}
              </div>
            </fieldset>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="task-outcome-note">{t("noteLabel")}</Label>
            <Textarea
              id="task-outcome-note"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("notePlaceholder")}
            />
          </div>

          <div className="space-y-2 rounded-lg border p-3">
            <p className="font-medium text-sm">{t("nextLabel")}</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[8rem_1fr]">
              <Select value={nextType} onValueChange={(v) => setNextType(taskTypeOf(v))}>
                <SelectTrigger className="w-full" aria-label={tType("label")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TASK_TYPES.map((k) => (
                    <SelectItem key={k} value={k}>
                      {tType(k)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={nextTitle}
                onChange={(e) => setNextTitle(e.target.value)}
                placeholder={t("nextTitlePlaceholder")}
                aria-label={t("nextTitleLabel")}
              />
            </div>
            {nextTitle.trim() && (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_DAYS.map(({ key, days }) => (
                    <Button
                      key={key}
                      type="button"
                      size="sm"
                      variant="ghost"
                      className={cn("h-7 px-2 text-xs", nextDate === dateInput(days) && "bg-muted")}
                      onClick={() => setNextDate(dateInput(days))}
                    >
                      {t(`quick.${key}`)}
                    </Button>
                  ))}
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Input
                    type="date"
                    value={nextDate}
                    onChange={(e) => setNextDate(e.target.value)}
                    aria-label={t("dateLabel")}
                  />
                  <Input
                    type="time"
                    value={nextTime}
                    onChange={(e) => setNextTime(e.target.value)}
                    aria-label={t("timeLabel")}
                    title={t("timeLabel")}
                  />
                </div>
              </>
            )}
            {!nextTitle.trim() && <p className="text-muted-foreground text-xs">{t("nextHint")}</p>}
          </div>
        </form>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t("cancel")}
          </Button>
          <Button type="submit" form="task-outcome" disabled={saving}>
            {saving ? t("saving") : t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
