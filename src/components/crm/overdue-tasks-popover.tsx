"use client";

import { useState } from "react";

import Link from "next/link";

import { differenceInDays } from "date-fns";
import { AlertCircle, CheckCircle2, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { updateTaskStatus } from "@/actions/tasks";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export interface OverdueTask {
  id: string;
  date: Date | string;
  displayTitle: string;
  entityName: string;
  link: string;
  priority: string;
}

export function OverdueTasksPopover({ tasks: initialTasks }: { tasks: OverdueTask[] }) {
  const t = useTranslations("calendar");
  const [tasks, setTasks] = useState(initialTasks);
  const [completing, setCompleting] = useState<Set<string>>(new Set());

  const handleComplete = async (taskId: string) => {
    setCompleting((prev) => new Set(prev).add(taskId));
    // brief visual delay before removing
    setTimeout(() => {
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      setCompleting((prev) => {
        const s = new Set(prev);
        s.delete(taskId);
        return s;
      });
    }, 300);
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
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors rounded px-1 -mx-1"
        >
          <AlertCircle className="h-3.5 w-3.5" />
          <span className="font-semibold">{tasks.length}</span>
          <span>{t("overdueTasks")}</span>
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-[min(24rem,calc(100vw-1.5rem))] p-0 shadow-lg" align="start" sideOffset={8}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b bg-red-50 dark:bg-red-950/20 rounded-t-md">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
            <span className="text-sm font-semibold text-red-800 dark:text-red-200">{t("overdueSection")}</span>
          </div>
          <Badge variant="destructive" className="text-xs tabular-nums">
            {tasks.length}
          </Badge>
        </div>

        <ScrollArea className="max-h-[360px]">
          {tasks.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              <CheckCircle2 className="h-8 w-8 text-green-400 mx-auto mb-2 opacity-60" />
              {t("noOverdueTasks")}
            </div>
          ) : (
            <div className="divide-y">
              {tasks.map((task) => {
                const daysLate = Math.max(1, differenceInDays(new Date(), new Date(task.date)));
                const isCompleting = completing.has(task.id);
                return (
                  <div
                    key={task.id}
                    className={cn(
                      "group flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-all",
                      isCompleting && "opacity-30 pointer-events-none",
                    )}
                  >
                    {/* Complete button */}
                    <button
                      type="button"
                      onClick={() => handleComplete(task.id)}
                      disabled={isCompleting}
                      title={t("markDone")}
                      className="shrink-0 flex h-5 w-5 items-center justify-center rounded-full border-2 border-muted-foreground/25 hover:border-green-500 hover:bg-green-50 dark:hover:bg-green-900/30 transition-all"
                    >
                      <CheckCircle2 className="h-3 w-3 text-transparent group-hover:text-green-500 transition-colors" />
                    </button>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium truncate">{task.displayTitle}</span>
                        {task.priority === "high" && (
                          <span className="shrink-0 text-[10px] font-bold text-red-600 dark:text-red-400">↑</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {task.entityName !== "No Entity" && (
                          <>
                            <span className="text-xs text-muted-foreground truncate">{task.entityName}</span>
                            <span className="text-muted-foreground/30 shrink-0">·</span>
                          </>
                        )}
                        <span className="text-xs font-medium text-red-500 shrink-0">
                          {t("daysOverdue", { count: daysLate })}
                        </span>
                      </div>
                    </div>

                    {/* Entity link */}
                    {task.link && task.link !== "#" && (
                      <Link
                        href={task.link}
                        className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                        title={task.entityName}
                      >
                        <ExternalLink className="h-3.5 w-3.5 text-muted-foreground hover:text-primary transition-colors" />
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
