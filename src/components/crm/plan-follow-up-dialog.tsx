"use client";

import { useEffect, useState, useTransition } from "react";

import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { createTask } from "@/actions/tasks";
import { TaskTypePicker } from "@/components/crm/task-type-picker";
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
import type { TaskType } from "@/lib/task-kinds";
import { cn } from "@/lib/utils";

/** A calendar date in the browser's zone, as `<input type="date">` wants it. */
function dateInput(daysAhead: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const QUICK = [
  { key: "tomorrow", days: 1 },
  { key: "in3", days: 3 },
  { key: "nextWeek", days: 7 },
] as const;

export type FollowUpTarget = { entity: "deal" | "lead" | "company"; id: string };

/**
 * "What is the next step?" — a task on a record, typed and dated in one short form.
 *
 * ⚠️ Asked where a deal is left with nothing planned: from the work list, and when a card
 * without a next step is moved to another stage. An open deal with no future activity is
 * the one that quietly dies, and the moment somebody touches it is the moment to ask.
 */
export function PlanFollowUpDialog({
  target,
  open,
  onOpenChange,
  title,
  onPlanned,
}: {
  target: FollowUpTarget;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What the record is called, shown under the question. */
  title?: string;
  onPlanned?: () => void;
}) {
  const t = useTranslations("planFollowUp");
  const tq = useTranslations("taskOutcome");
  const [type, setType] = useState<TaskType>("call");
  const [what, setWhat] = useState("");
  const [date, setDate] = useState(dateInput(1));
  const [time, setTime] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    setType("call");
    setWhat("");
    setDate(dateInput(1));
    setTime("");
  }, [open]);

  const save = () =>
    startTransition(async () => {
      try {
        await createTask({
          type,
          title: what.trim(),
          dueDate: date ? new Date(`${date}T${time || "00:00"}`) : undefined,
          allDay: !time,
          ...(target.entity === "deal"
            ? { dealId: target.id }
            : target.entity === "lead"
              ? { leadId: target.id }
              : { companyId: target.id }),
        });
        toast.success(t("planned"));
        onOpenChange(false);
        onPlanned?.();
      } catch {
        toast.error(t("failed"));
      }
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          {title && <DialogDescription className="break-words">{title}</DialogDescription>}
        </DialogHeader>
        <form
          id="plan-follow-up"
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (what.trim()) save();
          }}
        >
          <TaskTypePicker value={type} onChange={setType} />
          <Input
            autoFocus
            value={what}
            onChange={(e) => setWhat(e.target.value)}
            placeholder={tq("nextTitlePlaceholder")}
            aria-label={tq("nextTitleLabel")}
          />
          <div className="flex flex-wrap gap-1.5">
            {QUICK.map(({ key, days }) => (
              <Button
                key={key}
                type="button"
                size="sm"
                variant="ghost"
                className={cn("h-7 px-2 text-xs", date === dateInput(days) && "bg-muted")}
                onClick={() => setDate(dateInput(days))}
              >
                {tq(`quick.${key}`)}
              </Button>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label={tq("dateLabel")} />
            <Input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              aria-label={tq("timeLabel")}
              title={tq("timeLabel")}
            />
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {t("notNow")}
          </Button>
          <Button type="submit" form="plan-follow-up" disabled={pending || !what.trim()}>
            {t("plan")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
