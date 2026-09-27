"use client";

import type { ReactNode } from "react";

import { Download, FileText } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

export type ChatAttachment = { id: string; name: string; mimeType: string; size: number };

/** Somebody who can be named in a conversation: one of its members. */
export type ChatPerson = { userId: string; name: string | null; email: string | null };

/** The types the attachment route agrees to show inline; everything else downloads. */
const PREVIEWABLE = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

export function personLabel(p: { name: string | null; email: string | null }) {
  return p.name ?? p.email ?? "";
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The text with every `@Name` of a member picked out. Only members' names are
 * matched, longest first, so "@Anna Maria" is one mention and not "@Anna" and a
 * stray "Maria"; an `@` before anything else stays plain text.
 */
function withMentions(content: string, people: ChatPerson[], myId: string, isMe: boolean): ReactNode {
  const named = people
    .map((p) => ({ id: p.userId, label: personLabel(p) }))
    .filter((p) => p.label.length > 0)
    .sort((a, b) => b.label.length - a.label.length);
  if (named.length === 0 || !content.includes("@")) return content;

  const pattern = new RegExp(`@(${named.map((p) => escapeRegExp(p.label)).join("|")})(?![\\p{L}\\p{N}])`, "gu");
  const out: ReactNode[] = [];
  let last = 0;
  for (const match of content.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > last) out.push(content.slice(last, start));
    const person = named.find((p) => p.label === match[1]);
    const mine = person?.id === myId;
    out.push(
      <span
        key={start}
        className={cn(
          "whitespace-nowrap font-semibold",
          mine
            ? "rounded bg-amber-200 px-0.5 text-amber-950 dark:bg-amber-400/30 dark:text-amber-100"
            : isMe
              ? "underline decoration-primary-foreground/50 underline-offset-2"
              : "text-primary",
        )}
      >
        {match[0]}
      </span>,
    );
    last = start + match[0].length;
  }
  if (last < content.length) out.push(content.slice(last));
  return out;
}

/** Whether this text names `myId`, by the same rule the highlighting uses. */
export function mentionsMe(content: string, people: ChatPerson[], myId: string) {
  const me = people.find((p) => p.userId === myId);
  const label = me ? personLabel(me) : "";
  if (!label) return false;
  return new RegExp(`@${escapeRegExp(label)}(?![\\p{L}\\p{N}])`, "u").test(content);
}

/**
 * One message as it reads in a thread: its files first — an image as a picture,
 * anything else as a card to download — and then its text, with the people it
 * names picked out and the reader's own name marked hardest.
 */
export function ChatMessageBody({
  content,
  attachments,
  people,
  myId,
  isMe,
  bubbleClassName,
}: {
  content: string;
  attachments?: ChatAttachment[];
  people: ChatPerson[];
  myId: string;
  isMe: boolean;
  bubbleClassName?: string;
}) {
  const t = useTranslations("chat");
  const format = useFormatter();
  const files = attachments ?? [];
  const namesMe = !isMe && mentionsMe(content, people, myId);

  const size = (bytes: number) =>
    bytes >= 1_000_000
      ? format.number(bytes / 1_000_000, { style: "unit", unit: "megabyte", maximumFractionDigits: 1 })
      : format.number(Math.max(1, Math.round(bytes / 1000)), { style: "unit", unit: "kilobyte" });

  return (
    <div className={cn("flex min-w-0 max-w-full flex-col gap-1", isMe ? "items-end" : "items-start")}>
      {files.map((file) => {
        const href = `/api/chat/attachments/${file.id}`;
        if (PREVIEWABLE.has(file.mimeType)) {
          return (
            <a
              key={file.id}
              href={`${href}?view=1`}
              target="_blank"
              rel="noopener"
              className="block max-w-full overflow-hidden rounded-xl border bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {/* biome-ignore lint/performance/noImgElement: a private, per-member file; next/image would fetch it from its own optimiser, without the session */}
              <img
                src={`${href}?view=1`}
                alt={file.name}
                loading="lazy"
                className="block max-h-64 w-auto max-w-full object-contain"
              />
            </a>
          );
        }
        return (
          <a
            key={file.id}
            href={href}
            download={file.name}
            aria-label={t("download", { name: file.name })}
            className="flex max-w-full items-center gap-2.5 rounded-xl border bg-background px-3 py-2 text-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FileText className="size-4" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block truncate font-medium text-sm">{file.name}</span>
              <span className="block text-muted-foreground text-xs tabular-nums">{size(file.size)}</span>
            </span>
            <Download className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </a>
        );
      })}
      {content && (
        <div
          className={cn(
            "max-w-full whitespace-pre-wrap break-words rounded-2xl text-sm leading-relaxed",
            isMe ? "rounded-tr-sm bg-primary text-primary-foreground" : "rounded-tl-sm bg-muted text-foreground",
            namesMe && "ring-2 ring-amber-400/70",
            bubbleClassName,
          )}
        >
          {namesMe && <span className="sr-only">{t("youWereMentioned")}: </span>}
          {withMentions(content, people, myId, isMe)}
        </div>
      )}
    </div>
  );
}
