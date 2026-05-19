"use client";

import { useState, useTransition } from "react";

import Link from "next/link";

import { CheckCircle2, CheckSquare } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { updateTaskStatus } from "@/actions/tasks";
import { FormattedTime } from "@/components/crm/formatted-time";
import { cn } from "@/lib/utils";

const PILL_STYLE = "bg-blue-100 dark:bg-blue-950/70 text-blue-800 dark:text-blue-200 border-l-blue-500";

export interface CalendarTaskEvent {
  id: string;
  date: Date | string;
  displayTitle: string;
  entityName: string;
  link: string;
  status: string;
}

export function CalendarTaskPill({ event, compact = false }: { event: CalendarTaskEvent; compact?: boolean }) {
  const t = useTranslations("calendar");
  const [done, setDone] = useState(event.status === "done");
  const [isPending, startTransition] = useTransition();

  const handleComplete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (done || isPending) return;
    setDone(true);
    startTransition(async () => {
      try {
        await updateTaskStatus(event.id, "done");
      } catch {
        setDone(false);
        toast.error(t("taskDoneError"));
      }
    });
  };

  return (
    <div className="group/pill flex items-center gap-0.5">
      {/* Quick-complete circle */}
      <button
        type="button"
        onClick={handleComplete}
        disabled={done || isPending}
        title={t("markDone")}
        className={cn(
          "shrink-0 flex h-4 w-4 items-center justify-center rounded-full border transition-all",
          done
            ? "border-green-400 bg-green-100 dark:bg-green-900/40 cursor-default"
            : "border-muted-foreground/20 opacity-0 group-hover/pill:opacity-100 hover:border-green-400 hover:bg-green-50 dark:hover:bg-green-900/20",
        )}
      >
        <CheckCircle2
          className={cn(
            "h-2.5 w-2.5 transition-colors",
            done ? "text-green-500" : "text-muted-foreground/40 group-hover/pill:text-green-400",
          )}
        />
      </button>

      {/* Pill */}
      <Link href={event.link} className="flex-1 min-w-0" title={`${event.displayTitle} — ${event.entityName}`}>
        <div
          className={cn(
            "flex items-center gap-1.5 rounded border-l-[3px] px-1.5 py-1 text-xs leading-tight hover:opacity-80 transition-opacity",
            PILL_STYLE,
            done && "opacity-40",
          )}
        >
          <CheckSquare className="h-3 w-3 shrink-0" />
          {!compact && event.date && (
            <span className="font-semibold shrink-0 tabular-nums opacity-70">
              <FormattedTime date={event.date} />
            </span>
          )}
          <span className={cn("truncate font-medium", done && "line-through")}>{event.displayTitle}</span>
        </div>
      </Link>
    </div>
  );
}
