import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type TicketStatus = "open" | "in_progress" | "waiting" | "resolved" | "closed";

const statusConfig: Record<
  TicketStatus,
  { label: string; badgeClass: string; dotClass: string }
> = {
  open: {
    label: "Open",
    badgeClass:
      "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/50",
    dotClass: "bg-blue-500",
  },
  in_progress: {
    label: "In Progress",
    badgeClass:
      "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900/50",
    dotClass: "bg-amber-500",
  },
  waiting: {
    label: "Waiting",
    badgeClass:
      "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300 hover:bg-orange-200 dark:hover:bg-orange-900/50",
    dotClass: "bg-orange-500",
  },
  resolved: {
    label: "Resolved",
    badgeClass:
      "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-900/50",
    dotClass: "bg-green-500",
  },
  closed: {
    label: "Closed",
    badgeClass:
      "bg-gray-100 text-gray-600 dark:bg-gray-800/50 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-800",
    dotClass: "bg-gray-400",
  },
};

interface TicketStatusBadgeProps {
  status: string;
  /** Show only the colored dot, no text */
  dotOnly?: boolean;
  className?: string;
}

export function TicketStatusBadge({
  status,
  dotOnly = false,
  className = "",
}: TicketStatusBadgeProps) {
  const config = statusConfig[status as TicketStatus] ?? statusConfig.open;

  if (dotOnly) {
    return (
      <span
        className={cn("inline-block w-2 h-2 rounded-full flex-shrink-0", config.dotClass, className)}
        title={config.label}
      />
    );
  }

  return (
    <Badge
      variant="outline"
      className={cn("gap-1.5 font-medium", config.badgeClass, className)}
    >
      <span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", config.dotClass)} />
      {config.label}
    </Badge>
  );
}
