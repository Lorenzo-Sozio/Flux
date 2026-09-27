"use client";

import { useState, useTransition } from "react";

import { CheckCircle2Icon, CircleIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { updateTaskStatus } from "@/actions/tasks";
import { type OutcomeTask, TaskOutcomeDialog } from "@/components/crm/task-outcome-dialog";

/**
 * The round button beside a task on a record page. Completing asks "how did it go?"
 * (TaskOutcomeDialog); reopening a finished task needs no questions.
 */
export function TaskDoneButton({
  task,
  canWrite,
  revalidate,
}: {
  task: OutcomeTask & { status: string };
  canWrite: boolean;
  revalidate: string;
}) {
  const t = useTranslations("entityDetail");
  const [asking, setAsking] = useState(false);
  const [pending, startTransition] = useTransition();
  const done = task.status === "done";

  const onClick = () => {
    if (!done) {
      setAsking(true);
      return;
    }
    startTransition(async () => {
      try {
        await updateTaskStatus(task.id, "todo", revalidate);
      } catch {
        toast.error(t("undoFailed"));
      }
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        disabled={!canWrite || pending}
        aria-label={done ? t("undo") : t("markDone")}
        title={done ? t("undo") : t("markDone")}
        className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-primary disabled:pointer-events-none max-md:size-10"
      >
        {done ? (
          <CheckCircle2Icon className="size-4 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <CircleIcon className="size-4" />
        )}
      </button>
      {!done && <TaskOutcomeDialog task={task} open={asking} onOpenChange={setAsking} revalidate={revalidate} />}
    </>
  );
}
