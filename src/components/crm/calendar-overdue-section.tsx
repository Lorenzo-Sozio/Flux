"use client";

import { useState } from "react";

import Link from "next/link";

import { differenceInDays } from "date-fns";
import { AlertCircle, CheckCircle2, ChevronDown, Clock, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { updateTaskStatus } from "@/actions/tasks";
import { FormattedTime } from "@/components/crm/formatted-time";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface OverdueTaskItem {
  id: string;
  date: Date | string;
  displayTitle: string;
  entityName: string;
  link: string;
  priority: string;
}

export function CalendarOverdueSection({ tasks: initialTasks }: { tasks: OverdueTaskItem[] }) {
  const t = useTranslations("calendar");
  const [tasks, setTasks] = useState(initialTasks);
  const [open, setOpen] = useState(true);
  const [completing, setCompleting] = useState<Set<string>>(new Set());

  const handleComplete = async (taskId: string) => {
    setCompleting((prev) => new Set(prev).add(taskId));
    setTimeout(() => {
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      setCompleting((prev) => {
        const s = new Set(prev);
        s.delete(taskId);
        return s;
      });
    }, 350);
    try {
      await updateTaskStatus(taskId, "done");
      toast.success(t("markedDone"));
    } catch {
      setTasks((prev) => [...prev, initialTasks.find((t) => t.id === taskId)!]);
      setCompleting((prev) => {
        const s = new Set(prev);
        s.delete(taskId);
        return s;
      });
      toast.error(t("taskDoneError"));
    }
  };

  if (tasks.length === 0) return null;

  return (
    <div className="rounded-xl overflow-hidden border border-red-200 dark:border-red-900/40 bg-card shadow-sm">
      {/* Collapsible header */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-red-50 dark:bg-red-950/20 border-b border-red-200 dark:border-red-900/40 hover:bg-red-100 dark:hover:bg-red-950/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
          <span className="text-sm font-semibold text-red-800 dark:text-red-200">{t("overdueSection")}</span>
          <Badge variant="destructive" className="text-xs tabular-nums">
            {tasks.length}
          </Badge>
        </div>
        <ChevronDown className={cn("h-4 w-4 text-red-400 transition-transform duration-200", !open && "-rotate-90")} />
      </button>

      {/* Task list */}
      {open && (
        <div className="divide-y divide-red-100/60 dark:divide-red-900/20">
          {tasks.map((task) => {
            const daysLate = Math.max(1, differenceInDays(new Date(), new Date(task.date)));
            const isCompleting = completing.has(task.id);

            return (
              <div
                key={task.id}
                className={cn(
                  "group flex items-center gap-4 px-4 py-3.5 hover:bg-muted/30 transition-all",
                  isCompleting && "opacity-30 pointer-events-none",
                )}
              >
                {/* Complete button */}
                <button
                  type="button"
                  onClick={() => handleComplete(task.id)}
                  disabled={isCompleting}
                  title={t("markDone")}
                  className="shrink-0 flex h-6 w-6 items-center justify-center rounded-full border-2 border-red-300 dark:border-red-700 hover:border-green-500 hover:bg-green-50 dark:hover:bg-green-900/20 transition-all"
                >
                  <CheckCircle2 className="h-3.5 w-3.5 text-red-300 dark:text-red-700 group-hover:text-green-500 transition-colors" />
                </button>

                {/* Color bar */}
                <div className="w-1 self-stretch rounded-full bg-red-400 dark:bg-red-600 shrink-0" />

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold truncate">{task.displayTitle}</span>
                    {task.priority === "high" && <AlertCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {task.entityName !== "No Entity" && (
                      <>
                        <span className="text-xs text-muted-foreground truncate">{task.entityName}</span>
                        <span className="text-muted-foreground/30">·</span>
                      </>
                    )}
                    <span className="text-xs font-medium text-red-500 shrink-0">
                      {t("daysOverdue", { count: daysLate })}
                    </span>
                  </div>
                </div>

                {/* Time + entity link */}
                <div className="flex items-center gap-2.5 shrink-0">
                  <div className="flex items-center gap-1 text-xs text-red-400 tabular-nums">
                    <Clock className="h-3 w-3" />
                    <FormattedTime date={task.date} />
                  </div>
                  {task.link && task.link !== "#" && (
                    <Link
                      href={task.link}
                      className="opacity-0 group-hover:opacity-100 transition-opacity"
                      title={task.entityName}
                    >
                      <ExternalLink className="h-3.5 w-3.5 text-muted-foreground hover:text-primary transition-colors" />
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
