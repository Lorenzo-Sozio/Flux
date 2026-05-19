"use client";

import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type TicketStatus = "new" | "open" | "in_progress" | "waiting" | "on_hold" | "resolved" | "closed" | "pending";

const STATUS_STYLE: Record<TicketStatus, { badgeClass: string; dotClass: string }> = {
  new: {
    badgeClass:
      "bg-slate-100 text-slate-700 dark:bg-slate-800/50 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800",
    dotClass: "bg-slate-400",
  },
  open: {
    badgeClass:
      "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/50",
    dotClass: "bg-blue-500",
  },
  in_progress: {
    badgeClass:
      "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900/50",
    dotClass: "bg-amber-500",
  },
  waiting: {
    badgeClass:
      "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300 hover:bg-orange-200 dark:hover:bg-orange-900/50",
    dotClass: "bg-orange-500",
  },
  on_hold: {
    badgeClass:
      "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300 hover:bg-violet-200 dark:hover:bg-violet-900/50",
    dotClass: "bg-violet-500",
  },
  resolved: {
    badgeClass:
      "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-900/50",
    dotClass: "bg-green-500",
  },
  closed: {
    badgeClass:
      "bg-gray-100 text-gray-600 dark:bg-gray-800/50 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-800",
    dotClass: "bg-gray-400",
  },
  pending: {
    badgeClass:
      "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-900/50",
    dotClass: "bg-purple-400",
  },
};

interface TicketStatusBadgeProps {
  status: string;
  dotOnly?: boolean;
  className?: string;
}

export function TicketStatusBadge({ status, dotOnly = false, className = "" }: TicketStatusBadgeProps) {
  const t = useTranslations("support.tickets");
  const safeStatus = (status in STATUS_STYLE ? status : "open") as TicketStatus;
  const style = STATUS_STYLE[safeStatus];
  const label = t(`statuses.${safeStatus}`);

  if (dotOnly) {
    return (
      <span
        className={cn("inline-block w-2 h-2 rounded-full flex-shrink-0", style.dotClass, className)}
        title={label}
      />
    );
  }

  return (
    <Badge variant="outline" className={cn("gap-1.5 font-medium", style.badgeClass, className)}>
      <span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", style.dotClass)} />
      {label}
    </Badge>
  );
}
