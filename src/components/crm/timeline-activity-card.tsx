"use client";

import { useTransition } from "react";

import Link from "next/link";

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
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { deleteActivity } from "@/actions/activities";
import { ActivityModal } from "@/components/crm/activity-modal";
import { EmailActivityCard } from "@/components/crm/email-activity-card";
import { FormattedDate } from "@/components/crm/formatted-date";
import type { TimelineVia } from "@/lib/record-timeline";

type EmailV2 = {
  _type: "email_v2";
  subject: string;
  to: string;
  from?: string;
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

export const ACTIVITY_ICONS: Record<string, LucideIcon> = {
  note: StickyNoteIcon,
  call: PhoneCallIcon,
  meeting: CalendarIcon,
  email: MailIcon,
  // Written by the orders module, not by a person, and the only entry here that
  // means money changed hands (audit rilievo M-05).
  order: ShoppingCartIcon,
};

export const ACTIVITY_ICON_BG: Record<string, string> = {
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

export function viaHref(via: TimelineVia): string {
  return via.type === "deal" ? `/dashboard/pipeline/${via.id}` : `/dashboard/contacts/${via.id}`;
}

/** One activity on a record's timeline: what it was, who, when, what was said. */
export function TimelineActivityCard({
  activity,
  revalidatePathStr,
  canWrite,
  onDeleted,
}: {
  activity: {
    id: string;
    type: string;
    content: string | null;
    outcome: string | null;
    date: string | null;
    createdAt: string;
    durationMinutes: number | null;
    participants: string | null;
    ownerName: string | null;
    via: TimelineVia | null;
  };
  revalidatePathStr: string;
  /** False for a viewer: the edit and delete controls would only answer "forbidden". */
  canWrite: boolean;
  onDeleted: () => void;
}) {
  const tD = useTranslations("entityDetail");
  const tc = useTranslations("common");
  const tO = useTranslations("taskOutcome.outcomes");
  const tT = useTranslations("recordTimeline");
  const [pending, startTransition] = useTransition();

  const Icon = ACTIVITY_ICONS[activity.type] ?? StickyNoteIcon;
  const iconCls = ACTIVITY_ICON_BG[activity.type] ?? ACTIVITY_ICON_BG.note;
  const borderCls = BORDER_ACCENT[activity.type] ?? BORDER_ACCENT.note;
  const typeLabel = tD.has(`activityTypes.${activity.type}`)
    ? tD(`activityTypes.${activity.type}` as never)
    : activity.type;
  const emailV2 = activity.type === "email" ? parseEmailV2(activity.content) : null;
  const oldEmail = activity.type === "email" && !emailV2 ? parseOldEmail(activity.content) : null;

  const remove = () =>
    startTransition(async () => {
      try {
        await deleteActivity(activity.id, revalidatePathStr);
        onDeleted();
      } catch {
        toast.error(tT("deleteFailed"));
      }
    });

  return (
    <div className={`min-w-0 flex-1 overflow-hidden rounded-lg border border-l-[3px] bg-card shadow-sm ${borderCls}`}>
      <div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className={`inline-flex flex-shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5 font-bold text-[10px] uppercase tracking-widest ${iconCls}`}
          >
            <Icon className="h-2.5 w-2.5" />
            {typeLabel}
          </span>
          {activity.outcome && tO.has(activity.outcome) && (
            <span className="flex-shrink-0 rounded-sm border px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {tO(activity.outcome as never)}
            </span>
          )}
          {activity.ownerName && (
            <span className="flex min-w-0 items-center gap-1 text-muted-foreground text-xs">
              <UserIcon className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">{activity.ownerName}</span>
            </span>
          )}
          {activity.via && (
            <Link href={viaHref(activity.via)} className="min-w-0 truncate text-primary text-xs hover:underline">
              {tT("via", { name: activity.via.name })}
            </Link>
          )}
        </div>

        <div className="flex flex-shrink-0 items-center gap-1">
          <time className="whitespace-nowrap text-[10px] text-muted-foreground">
            <FormattedDate date={activity.date || activity.createdAt} />
          </time>
          {canWrite && (
            <>
              <ActivityModal mode="edit" activity={activity} revalidatePathStr={revalidatePathStr} />
              <button
                type="button"
                onClick={remove}
                disabled={pending}
                className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-destructive sm:size-auto sm:p-1"
                title={tc("delete")}
                aria-label={tc("delete")}
              >
                <Trash2Icon className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      <div className="px-3 py-2.5">
        {emailV2 ? (
          <EmailActivityCard email={emailV2} />
        ) : oldEmail ? (
          <div className="space-y-1">
            <p className="font-semibold text-sm leading-snug">{oldEmail.subject}</p>
            {oldEmail.preview && (
              <p className="break-words text-muted-foreground text-sm leading-relaxed">{oldEmail.preview}</p>
            )}
          </div>
        ) : (
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{activity.content}</p>
        )}
      </div>
    </div>
  );
}
