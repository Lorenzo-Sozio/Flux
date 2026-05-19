import { Badge } from "@/components/ui/badge";

export type TicketPriority = "urgent" | "high" | "normal" | "low";

const priorityConfig: Record<TicketPriority, { label: string; className: string; icon: string }> = {
  urgent: {
    label: "Urgent",
    className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/50",
    icon: "🔴",
  },
  high: {
    label: "High",
    className:
      "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300 hover:bg-orange-200 dark:hover:bg-orange-900/50",
    icon: "🟠",
  },
  normal: {
    label: "Normal",
    className:
      "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300 hover:bg-yellow-200 dark:hover:bg-yellow-900/50",
    icon: "🟡",
  },
  low: {
    label: "Low",
    className:
      "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-900/50",
    icon: "🟢",
  },
};

export const PRIORITY_ORDER: TicketPriority[] = ["low", "normal", "high", "urgent"];

interface TicketPriorityBadgeProps {
  priority: string;
  showIcon?: boolean;
  className?: string;
}

export function TicketPriorityBadge({ priority, showIcon = true, className = "" }: TicketPriorityBadgeProps) {
  const config = priorityConfig[priority as TicketPriority] ?? priorityConfig.normal;

  return (
    <Badge variant="outline" className={`${config.className} ${className}`}>
      {showIcon && <span className="mr-1">{config.icon}</span>}
      {config.label}
    </Badge>
  );
}
