"use client";

import type { RefObject } from "react";

import { Activity, FileText, Loader2, Lock, MessageSquare } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { sanitizeEmailHtml } from "@/lib/sanitize-email-html";
import { cn } from "@/lib/utils";

import {
  avatarColor,
  CHANNEL_ICONS,
  formatBytes,
  formatStamp,
  initials,
  labelOf,
  type TicketAuditEntry,
  type TicketDocument,
  type TicketMessage,
} from "./ticket-shared";

/**
 * The conversation itself: messages, internal notes and the changes made along
 * the way, oldest first, as they happened.
 */

function AuditEvent({ entry }: { entry: TicketAuditEntry }) {
  const t = useTranslations("support.tickets");
  const format = useFormatter();
  const actor = entry.actor?.name ?? entry.actorName ?? t("detail.system");
  const label = labelOf(t, "detail.audit", entry.action);
  // The values a status or priority change records are the stored words, which read as
  // English code; the ones this screen already knows are shown in the interface language.
  const valuePrefix =
    entry.action === "status_changed" ? "statuses" : entry.action === "priority_changed" ? "priorities" : null;
  const shown = (value: string) => (valuePrefix ? labelOf(t, valuePrefix, value) : value);
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="h-px flex-1 bg-border" />
      {/* Wraps below md: actor, action, old → new and time on one unbreakable
          line were wider than a phone, and the whole thread scrolled sideways. */}
      <div className="flex min-w-0 flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 text-center text-muted-foreground text-xs md:flex-nowrap md:whitespace-nowrap">
        <Activity className="h-2.5 w-2.5 shrink-0" />
        <span className="font-medium">{actor}</span>
        <span>·</span>
        <span>{label}</span>
        {entry.oldValue && entry.newValue && (
          <span className="flex items-center gap-1">
            <span className="line-through opacity-60">{shown(entry.oldValue)}</span>
            <span>→</span>
            <span className="font-medium">{shown(entry.newValue)}</span>
          </span>
        )}
        <span>·</span>
        <span>{formatStamp(new Date(entry.createdAt), format, t)}</span>
      </div>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

function AttachmentChips({ docs }: { docs: TicketDocument[] }) {
  if (!docs.length) return null;
  return (
    <div className="mt-2.5 flex flex-wrap gap-1.5">
      {docs.map((doc) => {
        const isPdf = doc.mimeType === "application/pdf";
        return (
          <a
            key={doc.id}
            href={`/api/documents/${doc.id}${isPdf ? "?view=1" : ""}`}
            target={isPdf ? "_blank" : undefined}
            download={!isPdf ? doc.name : undefined}
            rel="noopener noreferrer"
            className="flex min-h-8 items-center gap-1.5 rounded-md border bg-background/80 px-2 py-1 text-xs transition-colors hover:bg-muted"
          >
            <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
            <span className="max-w-[140px] truncate font-medium">{doc.name}</span>
            {doc.size != null && <span className="text-muted-foreground">({formatBytes(doc.size)})</span>}
          </a>
        );
      })}
    </div>
  );
}

/**
 * A message body, which is either plain text or the HTML of an email.
 *
 * Message bodies arrive from inbound customer email: this is markup written by a
 * stranger, rendered inside an authenticated agent's session.
 *
 * Two independent things stop that being stored XSS, and it needs to stay two.
 * `sanitizeEmailHtml` removes what executes without needing an HTML parser, which
 * matters because jsdom does not run on Workers and the bundle is already near the
 * 10 MB limit. Behind it the Content-Security-Policy in src/proxy.ts still holds the
 * line: no `unsafe-inline` in script-src, `frame-src 'none'`, `form-action 'self'`,
 * `img-src 'self' data: blob:`.
 *
 * WARN The sanitiser is a denylist, so it is only ever as good as its list. Do not
 * weaken the CSP on the strength of it.
 */
export function MessageBody({ content, className }: { content: string | null | undefined; className?: string }) {
  if (content?.startsWith("<")) {
    return (
      <div
        className={cn("prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed", className)}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: email HTML by definition; sanitised
        dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(content ?? "") }}
      />
    );
  }
  return <p className={cn("whitespace-pre-wrap text-sm leading-relaxed", className)}>{content}</p>;
}

function MessageBubble({ msg, docs, isAgent }: { msg: TicketMessage; docs?: TicketDocument[]; isAgent: boolean }) {
  const t = useTranslations("support.tickets");
  const format = useFormatter();
  const senderName = msg.sender?.name ?? msg.senderName ?? msg.senderEmail?.split("@")[0] ?? t("detail.unknownSender");
  const isInternal = !msg.isPublic;
  const stamp = formatStamp(new Date(msg.createdAt), format, t);

  if (isInternal) {
    return (
      <div className="rounded-xl border border-amber-200/60 bg-amber-50/70 px-3 py-2.5 sm:px-4 sm:py-3 dark:border-amber-800/30 dark:bg-amber-950/20">
        <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <div
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br font-bold text-[10px] text-white ${avatarColor(senderName)}`}
          >
            {initials(senderName)}
          </div>
          <span className="font-semibold text-amber-800 text-sm dark:text-amber-300">{senderName}</span>
          <Badge
            variant="secondary"
            className="h-4 gap-0.5 bg-amber-100 px-1.5 text-[10px] text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
          >
            <Lock className="h-2.5 w-2.5" /> {t("internalNote")}
          </Badge>
          <span className="ml-auto text-amber-600/70 text-xs dark:text-amber-500/60">{stamp}</span>
        </div>
        <div className="overflow-x-auto break-words [&_img]:h-auto [&_img]:max-w-full">
          <MessageBody
            content={msg.content}
            className="prose-p:text-amber-900 text-amber-900 dark:prose-p:text-amber-100 dark:text-amber-100"
          />
        </div>
        <AttachmentChips docs={docs ?? []} />
      </div>
    );
  }

  if (isAgent) {
    return (
      <div className="flex justify-end gap-3">
        <div className="min-w-0 max-w-[85%]">
          <div className="mb-1 flex flex-wrap items-center justify-end gap-x-2 gap-y-0.5">
            {msg.channel && <span className="text-muted-foreground/60">{CHANNEL_ICONS[msg.channel]}</span>}
            <span className="text-muted-foreground/70 text-xs">{stamp}</span>
            <span className="font-semibold text-sm">{senderName}</span>
          </div>
          <div className="overflow-x-auto break-words rounded-2xl rounded-tr-sm border border-primary/12 bg-primary/8 px-3 py-2.5 sm:px-4 sm:py-3 dark:bg-primary/12 [&_img]:h-auto [&_img]:max-w-full">
            <MessageBody content={msg.content} />
            <AttachmentChips docs={docs ?? []} />
          </div>
        </div>
        <div
          className={`mt-1 flex h-7 w-7 shrink-0 items-center justify-center self-start rounded-full bg-gradient-to-br font-bold text-[10px] text-white max-sm:hidden ${avatarColor(senderName)}`}
        >
          {initials(senderName)}
        </div>
      </div>
    );
  }

  // Customer message
  return (
    <div className="flex gap-3">
      <div
        className={`mt-1 flex h-7 w-7 shrink-0 items-center justify-center self-start rounded-full bg-gradient-to-br font-bold text-[10px] text-white max-sm:hidden ${avatarColor(senderName)}`}
      >
        {initials(senderName)}
      </div>
      <div className="min-w-0 max-w-[85%]">
        <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="font-semibold text-sm">{senderName}</span>
          {msg.senderEmail && (
            <span className="min-w-0 truncate text-muted-foreground/70 text-xs">&lt;{msg.senderEmail}&gt;</span>
          )}
          {msg.channel && <span className="text-muted-foreground/60">{CHANNEL_ICONS[msg.channel]}</span>}
          <span className="text-muted-foreground/70 text-xs">{stamp}</span>
        </div>
        {/* A customer's email can carry a wide table or an image at full size:
            it scrolls inside its own bubble rather than dragging the thread. */}
        <div className="overflow-x-auto break-words rounded-2xl rounded-tl-sm border border-border/60 bg-muted/60 px-3 py-2.5 sm:px-4 sm:py-3 [&_img]:h-auto [&_img]:max-w-full">
          <MessageBody content={msg.content} />
          <AttachmentChips docs={docs ?? []} />
        </div>
      </div>
    </div>
  );
}

/**
 * The thread, oldest at the top, the latest at the bottom — next to the reply box.
 *
 * ⚠️ It scrolls inside its own box, and the box is `flex-col-reverse`. Reversed,
 * a scroll container starts at its *bottom* and stays anchored there: the latest
 * message is what shows first, an older page loaded above it does not push the
 * reader's place away, and — the case that decided it — a thread first drawn
 * inside a hidden phone tab still opens at the latest message when the tab is
 * chosen. Scrolling it to the bottom from JavaScript could not do that last one: a
 * hidden box has no height to scroll.
 *
 * Half the screen on a phone, so the reply box under it is on screen as soon as
 * the page is scrolled a little, not a whole thread later. No
 * `overscroll-contain`: at the latest message a swipe carries on into the page,
 * which is how the reply box is reached with the thumb that was reading.
 */
export function TicketThread({
  messages,
  auditLogs,
  docsById,
  hasEarlier,
  loadingEarlier,
  onLoadEarlier,
  scrollRef,
  emptyHint,
}: {
  messages: TicketMessage[];
  auditLogs: TicketAuditEntry[];
  docsById: Record<string, TicketDocument>;
  hasEarlier: boolean;
  loadingEarlier: boolean;
  onLoadEarlier: () => void;
  scrollRef: RefObject<HTMLDivElement | null>;
  /** Under "no messages yet": what to do about it, or nothing for somebody who cannot reply. */
  emptyHint?: string;
}) {
  const t = useTranslations("support.tickets");

  // Build chronological timeline merging messages + audit events
  const timeline = [
    ...messages.map((m) => ({ type: "message" as const, ts: new Date(m.createdAt).getTime(), data: m })),
    ...auditLogs.map((a) => ({ type: "audit" as const, ts: new Date(a.createdAt).getTime(), data: a })),
  ].sort((a, b) => a.ts - b.ts);

  return (
    <div
      ref={scrollRef}
      className="flex max-h-[50dvh] min-h-0 flex-col-reverse overflow-y-auto px-3 py-4 sm:px-4 lg:max-h-[60dvh] lg:px-6"
    >
      <div className="space-y-4">
        {hasEarlier && (
          <div className="flex justify-center">
            <Button type="button" variant="outline" size="sm" onClick={onLoadEarlier} disabled={loadingEarlier}>
              {loadingEarlier && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t("loadEarlier")}
            </Button>
          </div>
        )}
        {timeline.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <MessageSquare className="mb-3 h-10 w-10 text-muted-foreground/20" />
            <p className="text-muted-foreground text-sm">{t("noMessages")}</p>
            {emptyHint && <p className="mt-1 text-muted-foreground/60 text-xs">{emptyHint}</p>}
          </div>
        ) : (
          timeline.map((item, i) => {
            if (item.type === "audit") {
              return <AuditEvent key={`audit-${item.data.id}-${i}`} entry={item.data} />;
            }
            const msg = item.data;
            const isAgent = !!msg.sender;
            const msgDocs = (msg.attachmentIds ?? []).map((docId: string) => docsById[docId]).filter(Boolean);
            return <MessageBubble key={msg.id ?? i} msg={msg} docs={msgDocs} isAgent={isAgent} />;
          })
        )}
      </div>
    </div>
  );
}
