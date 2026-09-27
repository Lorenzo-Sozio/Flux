"use client";

import { CheckSquareIcon, type LucideIcon, MailIcon, PhoneIcon, UsersIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { TASK_TYPES, type TaskType } from "@/lib/task-kinds";
import { cn } from "@/lib/utils";

export const TASK_TYPE_ICONS: Record<TaskType, LucideIcon> = {
  call: PhoneIcon,
  email: MailIcon,
  meeting: UsersIcon,
  todo: CheckSquareIcon,
};

/**
 * Call, email, meeting or to-do — four buttons rather than a dropdown, because it is the
 * first thing said about a task and one tap is what it should cost.
 */
export function TaskTypePicker({
  value,
  onChange,
  className,
}: {
  value: TaskType;
  onChange: (type: TaskType) => void;
  className?: string;
}) {
  const t = useTranslations("taskTypes");
  return (
    <div role="radiogroup" aria-label={t("label")} className={cn("grid grid-cols-4 gap-1.5", className)}>
      {TASK_TYPES.map((type) => {
        const Icon = TASK_TYPE_ICONS[type];
        const on = value === type;
        return (
          // biome-ignore lint/a11y/useSemanticElements: a row of buttons reads better than radio inputs here
          <button
            key={type}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(type)}
            className={cn(
              "flex min-w-0 flex-col items-center gap-1 rounded-md border px-1 py-2 text-xs transition-colors",
              on ? "border-primary bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted",
            )}
          >
            <Icon className="size-4" aria-hidden />
            <span className="truncate">{t(type)}</span>
          </button>
        );
      })}
    </div>
  );
}
