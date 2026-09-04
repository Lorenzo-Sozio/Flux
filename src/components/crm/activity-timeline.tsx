import type { LucideIcon } from "lucide-react";
import {
  CalendarIcon,
  MailIcon,
  PhoneCallIcon,
  ShoppingCartIcon,
  StickyNoteIcon,
  Trash2Icon,
  UserIcon,
} from "lucide-react";
import { getTranslations } from "next-intl/server";

import { deleteActivity } from "@/actions/activities";
import { ActivityModal } from "@/components/crm/activity-modal";
import { EmailActivityCard } from "@/components/crm/email-activity-card";
import { FormattedDate } from "@/components/crm/formatted-date";

type Activity = {
  id: string;
  type: string;
  content: string | null;
  date: Date | null;
  createdAt: Date | null;
  ownerName: string | null;
};

type EmailV2 = {
  _type: "email_v2";
  subject: string;
  to: string;
  snippet: string;
  bodyText: string;
};

function parseEmailV2(content: string | null): EmailV2 | null {
  if (!content?.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(content);
    if (parsed._type === "email_v2") return parsed as EmailV2;
  } catch {
    // Not JSON, so not an email written in this shape: fall through to the plain
    // rendering, which is what activities from before it looked like.
  }
  return null;
}

function parseOldEmail(content: string | null): { subject: string; preview: string } | null {
  if (!content) return null;
  const match = content.match(/^Sent Email:\s*(.+?)(?:\n\n([\s\S]*))?$/);
  if (!match) return null;
  return { subject: match[1].trim(), preview: (match[2] ?? "").trim() };
}

const ICONS: Record<string, LucideIcon> = {
  note: StickyNoteIcon,
  call: PhoneCallIcon,
  meeting: CalendarIcon,
  email: MailIcon,
  // Written by the orders module, not by a person, and the only entry here that
  // means money changed hands (audit rilievo M-05).
  order: ShoppingCartIcon,
};

const ICON_BG: Record<string, string> = {
  note: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
  call: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400",
  meeting: "bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400",
  email: "bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-400",
  order: "bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400",
};

const BORDER_ACCENT: Record<string, string> = {
  note: "border-l-slate-300 dark:border-l-slate-600",
  call: "border-l-emerald-400 dark:border-l-emerald-500",
  meeting: "border-l-blue-400 dark:border-l-blue-500",
  email: "border-l-violet-400 dark:border-l-violet-500",
  order: "border-l-amber-400 dark:border-l-amber-500",
};

export async function ActivityTimeline({
  activities,
  revalidatePathStr,
  noActivitiesLabel,
}: {
  activities: Activity[];
  revalidatePathStr: string;
  noActivitiesLabel?: string;
}) {
  const tD = await getTranslations("entityDetail");

  const typeLabels: Record<string, string> = {
    note: tD("activityTypes.note"),
    call: tD("activityTypes.call"),
    meeting: tD("activityTypes.meeting"),
    email: tD("activityTypes.email"),
    order: tD("activityTypes.order"),
  };

  if (activities.length === 0) {
    return <p className="py-8 text-center text-muted-foreground text-sm">{noActivitiesLabel ?? tD("noActivities")}</p>;
  }

  return (
    <div className="relative">
      {/* Vertical connector line */}
      <div className="pointer-events-none absolute top-5 bottom-5 left-[15px] w-px bg-border" aria-hidden />

      <div className="space-y-3">
        {activities.map((activity) => {
          const Icon = ICONS[activity.type] ?? StickyNoteIcon;
          const iconCls = ICON_BG[activity.type] ?? ICON_BG.note;
          const borderCls = BORDER_ACCENT[activity.type] ?? BORDER_ACCENT.note;

          const emailV2 = activity.type === "email" ? parseEmailV2(activity.content) : null;
          const oldEmail = activity.type === "email" && !emailV2 ? parseOldEmail(activity.content) : null;

          async function handleDelete() {
            "use server";
            await deleteActivity(activity.id, revalidatePathStr);
          }

          return (
            <div key={activity.id} className="relative flex gap-3">
              {/* Icon dot */}
              <div
                className={`relative z-10 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ring-2 ring-background ${iconCls}`}
              >
                <Icon className="h-4 w-4" />
              </div>

              {/* Card */}
              <div
                className={`min-w-0 flex-1 overflow-hidden rounded-lg border border-l-[3px] bg-card shadow-sm ${borderCls}`}
              >
                {/* Header */}
                <div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={`inline-flex flex-shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5 font-bold text-[10px] uppercase tracking-widest ${iconCls}`}
                    >
                      <Icon className="h-2.5 w-2.5" />
                      {typeLabels[activity.type] ?? activity.type}
                    </span>
                    {activity.ownerName && (
                      <span className="flex items-center gap-1 truncate text-muted-foreground text-xs">
                        <UserIcon className="h-3 w-3 flex-shrink-0" />
                        {activity.ownerName}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-shrink-0 items-center gap-1">
                    <time className="whitespace-nowrap text-[10px] text-muted-foreground">
                      <FormattedDate date={activity.date || activity.createdAt} />
                    </time>
                    <ActivityModal mode="edit" activity={activity} revalidatePathStr={revalidatePathStr} />
                    <form action={handleDelete}>
                      <button
                        type="submit"
                        className="p-1 text-muted-foreground transition-colors hover:text-destructive"
                        title="Delete"
                      >
                        <Trash2Icon className="h-3.5 w-3.5" />
                      </button>
                    </form>
                  </div>
                </div>

                {/* Body */}
                <div className="px-3 py-2.5">
                  {emailV2 ? (
                    <EmailActivityCard email={emailV2} />
                  ) : oldEmail ? (
                    <div className="space-y-1">
                      <p className="font-semibold text-sm leading-snug">{oldEmail.subject}</p>
                      {oldEmail.preview && (
                        <p className="text-muted-foreground text-sm leading-relaxed">{oldEmail.preview}</p>
                      )}
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{activity.content}</p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
