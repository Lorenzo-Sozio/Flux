"use client";

import type { ReactNode } from "react";

import { AlertCircle, CalendarIcon, CheckSquare, Clock, UserRound } from "lucide-react";
import { useTranslations } from "next-intl";

import { MetaItem, StatusBadge, type Tone } from "@/components/crm/record/record-page";
import { DialogTitle } from "@/components/ui/dialog";

const STATUS: Record<string, { labelKey: string; tone: Tone; icon: typeof Clock }> = {
  todo: { labelKey: "statuses.todo", tone: "neutral", icon: AlertCircle },
  in_progress: { labelKey: "statuses.inProgress", tone: "info", icon: Clock },
  done: { labelKey: "statuses.done", tone: "success", icon: CheckSquare },
};

// Normal is the default and says nothing, so it gets no badge. The tones are the
// deal page's: high is a warning, the two above it are danger.
const PRIORITY_TONE: Record<string, Tone> = {
  low: "neutral",
  high: "warning",
  critical: "danger",
  blocker: "danger",
};

export interface TaskRelatedLink {
  key: string;
  href: string;
  label: string;
  icon: ReactNode;
}

/**
 * The top of the task dialog, built like a record page's hero: the state first,
 * then the title, then who and where, then the figures.
 *
 * It shows what the form currently says, not what was last saved — the status
 * line did that before, and a badge that stayed "To do" after picking "Done" would
 * read as a save that had not taken.
 */
export function TaskDetailHero({
  title,
  status,
  priority,
  due,
  related,
  assignee,
  children,
}: {
  title: string;
  status: string;
  priority: string;
  /** `days` is null for a finished task: how late it was no longer matters. */
  due: { label: string; days: number | null } | null;
  related: TaskRelatedLink[];
  /** Undefined when the name is not known here (the picker loads its own list). */
  assignee: string | null | undefined;
  /** The figure row. */
  children?: ReactNode;
}) {
  const t = useTranslations("tasks");
  const tR = useTranslations("record");
  const st = STATUS[status] ?? STATUS.todo;
  const StatusIcon = st.icon;
  const overdue = due?.days != null && due.days < 0;
  const priorityTone = PRIORITY_TONE[priority];

  return (
    <div className="space-y-4">
      {/* Clear of the dialog's close button, which sits over this row's right end. */}
      <div className="flex flex-wrap items-center gap-2 pr-10">
        <StatusBadge tone={st.tone}>
          <StatusIcon aria-hidden />
          {t(st.labelKey)}
        </StatusBadge>
        {overdue && <StatusBadge tone="danger">{t("overdue")}</StatusBadge>}
        {priorityTone && <StatusBadge tone={priorityTone}>{t(`priorities.${priority}`)}</StatusBadge>}
      </div>

      <div className="min-w-0">
        <DialogTitle className="break-words font-bold text-lg leading-tight sm:text-xl">{title}</DialogTitle>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground text-sm">
          {related.map((r) => (
            <MetaItem key={r.key} icon={r.icon} href={r.href}>
              {r.label}
            </MetaItem>
          ))}
          {assignee !== undefined && (
            <MetaItem icon={<UserRound aria-hidden />}>
              {assignee ? tR("assignedTo", { name: assignee }) : tR("unassigned")}
            </MetaItem>
          )}
          {due && (
            <MetaItem icon={<CalendarIcon aria-hidden />}>
              <span className={overdue ? "font-medium text-destructive" : undefined}>
                {t("modal.hero.due", { date: due.label })}
                {due.days != null && (
                  <>
                    {" · "}
                    {due.days === 0
                      ? tR("today")
                      : due.days < 0
                        ? tR("overdueBy", { days: -due.days })
                        : tR("inDays", { days: due.days })}
                  </>
                )}
              </span>
            </MetaItem>
          )}
        </div>
      </div>

      {children}
    </div>
  );
}
