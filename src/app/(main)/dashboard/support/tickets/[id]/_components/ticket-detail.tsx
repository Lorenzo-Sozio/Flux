"use client";

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Clock,
  Flag,
  Hash,
  Info,
  ListChecks,
  MessageSquare,
  MoreHorizontal,
  Pause,
  Reply,
  RotateCcw,
  Trash2,
  TrendingUp,
  User,
  UserCheck,
  UserRound,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";

import {
  addTicketMessageAction,
  deleteTicketAction,
  escalateTicketAction,
  getMacros,
  getTicketById,
  getTicketTimelineBefore,
  reassignTicketAction,
  updateTicketAction,
} from "@/actions/support";
import { getAllUsers, getTasksByTicketId } from "@/actions/tasks";
import { AiSummaryCard } from "@/components/crm/ai/ai-summary-card";
import { AssigneeSelect, decodeAssignee, encodeAssignee } from "@/components/crm/assignee-select";
import {
  MetaItem,
  Metric,
  MetricStrip,
  RecordBackLink,
  RecordHero,
  RecordPage,
  StatusBadge,
} from "@/components/crm/record/record-page";
import { RecordSections } from "@/components/crm/record/record-sections";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AiEntry } from "@/lib/ai/types";
import { canTransition } from "@/lib/ticket-state-machine";
import { mergeThread, oldestOf } from "@/lib/ticket-thread";

import { HandoverCard } from "../../_components/handover-card";
import { TriageCard } from "../../_components/triage-card";
import {
  AttachmentsCard,
  CustomerHistoryCard,
  OrderCard,
  PropertiesCard,
  RequesterCard,
  SlaCard,
  TasksCard,
} from "./ticket-cards";
import { COMPOSER_ID, TicketComposer } from "./ticket-composer";
import {
  CHANNEL_ICONS,
  formatDuration,
  type LinkedTask,
  labelOf,
  messageOf,
  PRIORITY_TONE,
  type PresenceEntry,
  SEVERITY_TONE,
  SLA_TONE,
  type SlaState,
  STATUS_TONE,
  slaDeadlines,
  slaStateOf,
  type TicketAuditEntry,
  type TicketDocument,
  type TicketMacro,
  type TicketMessage,
  type TicketPriority,
  type TicketRow,
  type TicketStatus,
} from "./ticket-shared";
import { TicketThread } from "./ticket-thread";

const SLA_ICON: Record<SlaState, ReactNode> = {
  breached: <AlertTriangle aria-hidden />,
  atRisk: <Clock aria-hidden />,
  paused: <Pause aria-hidden />,
  met: <CheckCircle2 aria-hidden />,
  onTrack: <Clock aria-hidden />,
};

const STAMP = { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" } as const;

/**
 * The time, once the page is in the browser, and again every minute.
 *
 * Null on the server and on the first client render: the two disagree about what
 * time it is, and a countdown that differed between them would be a hydration
 * mismatch. Everything that counts down shows "—" for that first instant.
 */
function useNow(interval = 60_000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(timer);
  }, [interval]);
  return now;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

/**
 * One ticket, laid out for the agent answering it — the same record layout as
 * every other page in the CRM, bent where a conversation needs it to bend.
 *
 * ⚠️ This used to be a screen of its own: a fixed-height frame with the thread
 * scrolling inside it, a reply box pinned under it and a 300px column of cards
 * beside it, and on a phone a Details button that swapped the conversation for
 * the cards. It now has the hero, the figures and the sections every record has,
 * so an agent who has learnt the deal page has learnt this one. What it keeps
 * from the old frame is what made it a support screen: the thread scrolls in its
 * own box, anchored at the latest message, with the reply box directly under it,
 * so answering never means scrolling past the whole conversation first — and the
 * hero's Reply button goes straight there from anywhere on the page.
 *
 * ⚠️ It was also the page itself, a client component that asked for its ticket in
 * a `useEffect`. The server page now loads the ticket and the macros and hands
 * them in; `loadTicket` stays, for the refreshes that follow a reply. When the
 * server could not load the ticket the props are empty and the screen loads it
 * itself, so a failure degrades to the old behaviour rather than to a broken page.
 */
export function TicketDetail({
  id,
  initialTicket,
  initialMacros,
  canWrite,
  canDelete,
  aiSummary,
}: {
  /** Offer the copilot's summary of the thread, for whoever takes the ticket over (Fase 5, C2). */
  aiSummary?: AiEntry;
  id: string;
  initialTicket: TicketRow | null;
  initialMacros: TicketMacro[];
  /** `ticket:write` — replying, changing status/priority/assignee, tasks, linking an order. */
  canWrite: boolean;
  /** `ticket:delete`, which is an admin's. */
  canDelete: boolean;
}) {
  const t = useTranslations("support.tickets");
  const tR = useTranslations("record");
  const tH = useTranslations("handover");
  const format = useFormatter();
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);
  const now = useNow();

  const [ticket, setTicket] = useState<TicketRow | null>(initialTicket);
  const [messages, setMessages] = useState<TicketMessage[]>(() => mergeThread(initialTicket?.messages ?? [], []));
  const [auditLogs, setAuditLogs] = useState<TicketAuditEntry[]>(() => mergeThread(initialTicket?.auditLogs ?? [], []));
  const [macros, setMacros] = useState<TicketMacro[]>(initialMacros);
  // Only when the server could not load the ticket does the screen wait for one.
  const [loading, setLoading] = useState(!initialTicket);
  const [presence, setPresence] = useState<PresenceEntry[]>([]);
  const [ticketDocs, setTicketDocs] = useState<Record<string, TicketDocument>>({});
  /** Whether an older page is on its way, so the button cannot fire twice. */
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  // Held here rather than in the tasks card, so the phone's Tasks tab can show
  // how many are open before it is opened.
  const [tasks, setTasks] = useState<LinkedTask[]>([]);
  const [users, setUsers] = useState<{ id: string; name: string | null }[]>([]);

  const [replyContent, setReplyContent] = useState("");
  const [isInternal, setIsInternal] = useState(false);
  const { data: session } = useSession();

  /**
   * Fills the composer from a saved reply.
   *
   * One function rather than two call sites, because the triage panel now offers
   * the same macros the dropdown does and the two must substitute identically.
   *
   * ⚠️ `{agent.name}` used to be replaced with nothing at all, so a macro signed
   * off by the agent went to the customer with a blank where the name belongs —
   * and it looked fine in the editor, because the placeholder was already gone.
   */
  const applyMacro = useCallback(
    (macro: TicketMacro) => {
      setReplyContent(
        macro.body
          .replace(/\{ticket\.number\}/g, ticket?.ticketNumber ?? "")
          .replace(/\{contact\.firstName\}/g, ticket?.contact?.firstName ?? "")
          .replace(/\{agent\.name\}/g, session?.user?.name ?? ""),
      );
      setIsInternal(!macro.isPublic);
    },
    [ticket?.ticketNumber, ticket?.contact?.firstName, session?.user?.name],
  );
  const [sending, setSending] = useState(false);

  const [reassignOpen, setReassignOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selectedAssignee, setSelectedAssignee] = useState<string>(
    initialTicket ? encodeAssignee(initialTicket.assigneeId, null) : "__none__",
  );
  const [reassigning, setReassigning] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      // The thread is `flex-col-reverse`, where the bottom is scrollTop 0 and a
      // positive target clamps to it; scrollHeight works in either direction.
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    });
  }, []);

  /** The ticket's attachments, keyed by id for the links inside the thread. */
  const loadDocuments = useCallback(async () => {
    const docsRes = await fetch(`/api/documents?entityType=ticket&entityId=${id}`)
      .then((r) => r.json())
      .catch(() => ({ documents: [] }));
    const docsById: Record<string, TicketDocument> = {};
    for (const doc of docsRes.documents ?? []) docsById[doc.id] = doc;
    setTicketDocs(docsById);
  }, [id]);

  const loadTicket = useCallback(async () => {
    try {
      const [data] = await Promise.all([getTicketById(id), loadDocuments()]);
      if (data) {
        setTicket(data);
        // ⚠️ Merged, not replaced. This runs again after every reply, and it loads
        // only the latest page: replacing would throw away every older page the
        // agent had opened, and the conversation they were reading would vanish
        // from above the reply they had just sent.
        setMessages((held) => mergeThread(data.messages ?? [], held));
        setAuditLogs((held) => mergeThread(data.auditLogs ?? [], held));
        setSelectedAssignee(encodeAssignee(data.assigneeId, null));
      }
    } catch (e) {
      console.error("Failed to load ticket:", e);
    } finally {
      setLoading(false);
    }
  }, [id, loadDocuments]);

  const loadTasks = useCallback(() => getTasksByTicketId(id).then(setTasks).catch(console.error), [id]);

  // The ticket and the macros arrive with the page. The attachments still load
  // here: they are secondary, and the links in the thread fill in a moment later.
  // Without a ticket from the server, load everything as the page always did.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, on mount
  useEffect(() => {
    void loadTasks();
    getAllUsers().then(setUsers).catch(console.error);
    if (initialTicket) {
      void loadDocuments();
      return;
    }
    loadTicket();
    getMacros().then(setMacros).catch(console.error);
  }, []);
  useEffect(() => {
    const announce = (action: "viewing" | "typing") =>
      fetch(`/api/tickets/${id}/presence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      }).catch(console.error);
    const poll = () =>
      fetch(`/api/tickets/${id}/presence`)
        .then((r) => r.json())
        .then((d: PresenceEntry[]) => setPresence(d))
        .catch(console.error);
    announce("viewing");
    poll();
    const t = setInterval(() => {
      announce("viewing");
      poll();
    }, 15_000);
    return () => clearInterval(t);
  }, [id]);

  const isReplyEmpty = !replyContent.trim() || replyContent === "<p></p>";

  const handleSendReply = useCallback(async () => {
    if (isReplyEmpty) return;
    setSending(true);
    try {
      const result = await addTicketMessageAction(id, {
        content: replyContent,
        channel: (ticket?.channel ?? "email") as "email" | "phone" | "chat" | "social",
        isPublic: !isInternal,
      });
      if (result?.linkedFromClosed) {
        toast.info(t("detail.reopenedAsNew", { number: result.newTicketNumber ?? "" }));
        router.push(`/dashboard/support/tickets/${result.newTicketId}`);
        return;
      }
      setReplyContent("<p></p>");
      await loadTicket();
      scrollToBottom();
    } catch (err) {
      toast.error(messageOf(err, t("detail.sendFailed")));
    } finally {
      setSending(false);
    }
  }, [id, isInternal, isReplyEmpty, loadTicket, replyContent, router, scrollToBottom, ticket?.channel, t]);

  // ⚠️ A status or priority change reloads the ticket as well as patching it. The
  // server moves more than the field that was chosen — resolving stamps
  // `resolvedAt`, "waiting" pauses the SLA, a new priority re-computes both
  // deadlines — and the change itself lands in the thread as an audit line. Patched
  // alone, the figures above kept counting down to a deadline that no longer
  // existed until somebody refreshed.
  const handleStatusChange = useCallback(
    async (status: TicketStatus) => {
      try {
        await updateTicketAction(id, { status });
        setTicket((p) => (p ? { ...p, status } : p));
        toast.success(t("statusUpdated"));
        void loadTicket();
      } catch (err) {
        toast.error(messageOf(err, t("detail.error")));
      }
    },
    [id, loadTicket, t],
  );

  const handlePriorityChange = useCallback(
    async (priority: TicketPriority) => {
      try {
        await updateTicketAction(id, { priority });
        setTicket((p) => (p ? { ...p, priority } : p));
        toast.success(t("priorityUpdated"));
        void loadTicket();
      } catch (err) {
        toast.error(messageOf(err, t("detail.error")));
      }
    },
    [id, loadTicket, t],
  );

  const handleEscalate = useCallback(async () => {
    try {
      const result = await escalateTicketAction(id);
      if (result.alreadyMaxPriority) {
        toast.info(t("priorityAlreadyMax"));
        return;
      }
      setTicket((p) => (p && result.newPriority ? { ...p, priority: result.newPriority } : p));
      toast.success(
        t("detail.escalated", { priority: result.newPriority ? labelOf(t, "priorities", result.newPriority) : "" }),
      );
      void loadTicket();
    } catch (err) {
      toast.error(messageOf(err, t("detail.error")));
    }
  }, [id, loadTicket, t]);

  const handleReassign = useCallback(async () => {
    setReassigning(true);
    try {
      const { ownerId } = decodeAssignee(selectedAssignee);
      await reassignTicketAction(id, ownerId);
      await loadTicket();
      setReassignOpen(false);
      toast.success(ownerId ? t("detail.reassigned") : t("detail.assigneeRemoved"));
    } catch (err) {
      toast.error(messageOf(err, t("detail.error")));
    } finally {
      setReassigning(false);
    }
  }, [id, loadTicket, selectedAssignee, t]);

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    try {
      await deleteTicketAction(id);
      toast.success(t("deleted"));
      router.push("/dashboard/support/tickets");
    } catch (err) {
      toast.error(messageOf(err, t("detail.error")));
      setDeleting(false);
      setDeleteOpen(false);
    }
  }, [id, router, t]);

  /**
   * The hero's Reply: bring the composer into view and put the caret in it.
   *
   * ⚠️ On a phone the composer lives in the Conversation tab, and an element in a
   * hidden tab can be neither scrolled to nor focused. `RecordSections` owns the
   * chosen tab and offers no way to set it, so this presses the tab's own button —
   * the one path that also keeps the URL fragment right. Only when that button is
   * on screen: from lg up the bar is `display: none`, every section is visible,
   * and a click there would only make the sections scroll the page to their top.
   */
  const focusComposer = useCallback(() => {
    const tab = document.getElementById("record-tab-conversation");
    if (tab && tab.offsetParent !== null && tab.getAttribute("aria-selected") !== "true") tab.click();
    requestAnimationFrame(() => {
      const composer = document.getElementById(COMPOSER_ID);
      composer?.scrollIntoView({ behavior: "smooth", block: "center" });
      composer?.querySelector<HTMLElement>("[contenteditable='true']")?.focus({ preventScroll: true });
    });
  }, []);

  /** More of the thread exists than the screen holds. Counted, not inferred from a page length. */
  const hasEarlier = ticket
    ? messages.length < (ticket.messageCount ?? 0) || auditLogs.length < (ticket.auditCount ?? 0)
    : false;

  const loadEarlier = async () => {
    const before = oldestOf(messages, auditLogs);
    if (!before || loadingEarlier) return;
    setLoadingEarlier(true);
    try {
      const older = await getTicketTimelineBefore(id, before.toISOString());
      setMessages((held) => mergeThread(older.messages, held));
      setAuditLogs((held) => mergeThread(older.auditLogs, held));
    } catch (e) {
      console.error("Failed to load earlier messages:", e);
      toast.error(t("loadEarlierFailed"));
    } finally {
      setLoadingEarlier(false);
    }
  };

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex animate-pulse flex-col gap-4 sm:gap-6">
        <div className="h-44 rounded-xl bg-muted" />
        <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-3">
          <div className="space-y-4 lg:order-2 lg:col-span-2">
            <div className="h-96 rounded-xl bg-muted" />
          </div>
          <div className="space-y-4 max-lg:hidden">
            <div className="h-48 rounded-xl bg-muted" />
            <div className="h-28 rounded-xl bg-muted" />
          </div>
        </div>
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="py-24 text-center">
        <MessageSquare className="mx-auto mb-4 h-12 w-12 text-muted-foreground/20" />
        <p className="mb-4 text-muted-foreground">{t("notFound")}</p>
        <Button asChild variant="outline">
          <Link href="/dashboard/support/tickets">← {t("detail.backToTickets")}</Link>
        </Button>
      </div>
    );
  }

  // ── Derived ──────────────────────────────────────────────────────────────────
  const typingUsers = presence.filter((p) => p.action === "typing");
  const priority = ticket.priority ?? "normal";
  const created = new Date(ticket.createdAt).getTime();
  const { firstDue, resolutionDue } = slaDeadlines(ticket);
  const slaState = slaStateOf(ticket, now);
  const paused = !!ticket.slaPausedAt;
  // When the ticket stopped being work: resolved, or closed without ever being
  // resolved (straight from "new", say). Past that, nothing counts down.
  const doneAt = ticket.resolvedAt
    ? new Date(ticket.resolvedAt).getTime()
    : ticket.closedAt
      ? new Date(ticket.closedAt).getTime()
      : null;
  const endedAt = ticket.closedAt ? new Date(ticket.closedAt).getTime() : doneAt;
  const contactName = ticket.contact
    ? `${ticket.contact.firstName ?? ""} ${ticket.contact.lastName ?? ""}`.trim() || null
    : null;
  const openTasks = tasks.filter((tk) => tk.status !== "done").length;
  const waiting = ticket.handoverSummary?.waiting;

  /** Time left to a deadline, or how far past it — "3h 20m" or "3h 20m overdue". */
  const countdown = (due: Date) => {
    if (now === null) return "—";
    const left = due.getTime() - now;
    return left >= 0 ? formatDuration(left, t) : t("detail.metrics.overdue", { duration: formatDuration(left, t) });
  };
  const isPast = (due: Date | null) => due !== null && now !== null && due.getTime() < now;

  // ── Metrics ──────────────────────────────────────────────────────────────────
  // The figures an agent triages by: how long is left, whether anybody has
  // answered, how long it has been going on, and how much has been said.
  const resolutionMetric =
    doneAt !== null ? (
      <Metric
        label={labelOf(t, "statuses", ticket.resolvedAt ? "resolved" : "closed")}
        tone={slaState === "breached" ? "danger" : resolutionDue ? "success" : undefined}
        hint={t("detail.metrics.after", { duration: formatDuration(doneAt - created, t) })}
      >
        {format.dateTime(new Date(doneAt), { day: "numeric", month: "short" })}
      </Metric>
    ) : resolutionDue ? (
      <Metric
        label={t("detail.metrics.resolutionDue")}
        tone={isPast(resolutionDue) && !paused ? "danger" : undefined}
        hint={paused ? t("detail.sla.paused") : format.dateTime(resolutionDue, STAMP)}
      >
        {countdown(resolutionDue)}
      </Metric>
    ) : null;

  const firstResponseMetric = ticket.firstResponseAt ? (
    <Metric
      label={t("firstResponse")}
      tone={ticket.firstResponseBreachedAt ? "danger" : firstDue ? "success" : undefined}
      hint={format.dateTime(new Date(ticket.firstResponseAt), STAMP)}
    >
      {formatDuration(new Date(ticket.firstResponseAt).getTime() - created, t)}
    </Metric>
  ) : doneAt === null && firstDue ? (
    <Metric
      label={t("firstResponse")}
      tone={isPast(firstDue) && !paused ? "danger" : undefined}
      hint={t("detail.sla.dueAt", { date: format.dateTime(firstDue, STAMP) })}
    >
      {countdown(firstDue)}
    </Metric>
  ) : (
    <Metric label={t("firstResponse")}>{doneAt === null ? t("detail.metrics.notYet") : "—"}</Metric>
  );

  const ageMetric = (
    <Metric
      label={t("detail.metrics.age")}
      hint={
        endedAt !== null
          ? t("detail.metrics.closedOn", {
              date: format.dateTime(new Date(endedAt), { day: "numeric", month: "short" }),
            })
          : t("detail.metrics.since", { date: format.dateTime(new Date(created), { day: "numeric", month: "short" }) })
      }
    >
      {endedAt !== null ? formatDuration(endedAt - created, t) : now === null ? "—" : formatDuration(now - created, t)}
    </Metric>
  );

  const messagesMetric = (
    <Metric
      label={t("detail.metrics.messages")}
      hint={doneAt === null && waiting && waiting !== "nobody" ? tH(`waiting.${waiting}`) : undefined}
    >
      {ticket.messageCount ?? messages.length}
    </Metric>
  );

  // What the customer said when asked (src/lib/ticket-public.ts): shown once they were asked.
  const csatMetric = ticket.csatRating ? (
    <Metric
      label={t("detail.csat.label")}
      tone={ticket.csatRating === "good" ? "success" : "danger"}
      hint={ticket.csatComment ? `“${ticket.csatComment.slice(0, 140)}”` : t("detail.csat.noComment")}
    >
      {t(ticket.csatRating === "good" ? "detail.csat.good" : "detail.csat.bad")}
    </Metric>
  ) : ticket.csatRequestedAt ? (
    <Metric
      label={t("detail.csat.label")}
      hint={t("detail.csat.askedOn", {
        date: format.dateTime(new Date(ticket.csatRequestedAt), { day: "numeric", month: "short" }),
      })}
    >
      {t("detail.csat.waiting")}
    </Metric>
  ) : null;

  // ── Sections ─────────────────────────────────────────────────────────────────
  const conversation = (
    <Card className="gap-0 py-0 sm:gap-0 sm:py-0">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-3 sm:px-4 lg:px-6">
        <h2 className="font-semibold text-base">{tR("tabs.conversation")}</h2>
        <span className="text-muted-foreground text-xs tabular-nums">
          {t("detail.messagesCount", { count: ticket.messageCount ?? messages.length })}
        </span>
      </div>
      {typingUsers.length > 0 && (
        <div className="flex items-center gap-2 border-b bg-amber-50/80 px-3 py-2 text-amber-700 text-xs sm:px-4 lg:px-6 dark:border-amber-800/30 dark:bg-amber-950/20 dark:text-amber-400">
          <span className="flex gap-0.5">
            {[0, 150, 300].map((d) => (
              <span
                key={d}
                className="h-1.5 w-1.5 animate-bounce rounded-full bg-amber-500"
                style={{ animationDelay: `${d}ms` }}
              />
            ))}
          </span>
          {t("detail.typing", {
            count: typingUsers.length,
            names: typingUsers.map((p) => p.userName).join(", "),
          })}
        </div>
      )}
      <TicketThread
        messages={messages}
        auditLogs={auditLogs}
        docsById={ticketDocs}
        hasEarlier={hasEarlier}
        loadingEarlier={loadingEarlier}
        onLoadEarlier={loadEarlier}
        scrollRef={scrollRef}
        emptyHint={canWrite ? t("sendFirstReply") : undefined}
      />
      {canWrite ? (
        <TicketComposer
          ticketId={id}
          value={replyContent}
          onChange={setReplyContent}
          isInternal={isInternal}
          onInternalChange={setIsInternal}
          macros={macros}
          onApplyMacro={applyMacro}
          onSend={handleSendReply}
          sending={sending}
        />
      ) : (
        <p className="border-t px-3 py-3 text-muted-foreground text-sm sm:px-4 lg:px-6">{t("detail.readOnly")}</p>
      )}
    </Card>
  );

  return (
    <RecordPage>
      <RecordBackLink href="/dashboard/support/tickets">{t("allTickets")}</RecordBackLink>

      {/* ── Hero: what it is, where it stands against its promise, who asked ── */}
      <RecordHero
        badges={
          <>
            <StatusBadge tone={STATUS_TONE[ticket.status] ?? "neutral"}>
              {labelOf(t, "statuses", ticket.status)}
            </StatusBadge>
            <StatusBadge tone={PRIORITY_TONE[priority] ?? "neutral"}>
              <Flag aria-hidden />
              {labelOf(t, "priorities", priority)}
            </StatusBadge>
            {slaState && (
              <StatusBadge tone={SLA_TONE[slaState]}>
                {SLA_ICON[slaState]}
                {t(`detail.sla.state.${slaState}`)}
              </StatusBadge>
            )}
            {ticket.severity && SEVERITY_TONE[ticket.severity] && (
              <StatusBadge tone={SEVERITY_TONE[ticket.severity]}>
                {t("detail.severityBadge", { severity: labelOf(t, "detail.severities", ticket.severity) })}
              </StatusBadge>
            )}
          </>
        }
        title={ticket.subject}
        meta={
          <>
            <MetaItem icon={<Hash aria-hidden />}>
              <span className="font-mono">{ticket.ticketNumber}</span>
            </MetaItem>
            {contactName && ticket.contact && (
              <MetaItem icon={<User aria-hidden />} href={`/dashboard/contacts/${ticket.contact.id}`}>
                {contactName}
              </MetaItem>
            )}
            {ticket.company && (
              <MetaItem icon={<Building2 aria-hidden />} href={`/dashboard/companies/${ticket.company.id}`}>
                {ticket.company.name}
              </MetaItem>
            )}
            <MetaItem icon={<UserRound aria-hidden />}>
              {ticket.assignee?.name ? tR("assignedTo", { name: ticket.assignee.name }) : tR("unassigned")}
            </MetaItem>
            <MetaItem icon={CHANNEL_ICONS[ticket.channel]}>{labelOf(t, "channels", ticket.channel)}</MetaItem>
          </>
        }
        actions={
          (canWrite || canDelete) && (
            <>
              {canWrite && (
                <Button size="sm" onClick={focusComposer}>
                  <Reply className="size-3.5" aria-hidden />
                  {t("detail.reply")}
                </Button>
              )}
              {canWrite && canTransition(ticket.status, "resolved") && (
                <Button size="sm" variant="outline" onClick={() => handleStatusChange("resolved")}>
                  <CheckCircle2 className="size-3.5" aria-hidden />
                  {t("detail.resolve")}
                </Button>
              )}
              {canWrite && ticket.status === "resolved" && (
                <Button size="sm" variant="outline" onClick={() => handleStatusChange("open")}>
                  <RotateCcw className="size-3.5" aria-hidden />
                  {t("detail.reopen")}
                </Button>
              )}
              {/* The rarer moves. Reassign and delete open their dialogs from
                  state outside the menu, never from inside it. */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline">
                    <MoreHorizontal className="size-3.5" aria-hidden />
                    {tR("more")}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  {canWrite && (
                    <>
                      <DropdownMenuItem onClick={() => setReassignOpen(true)} className="gap-2">
                        <UserCheck className="h-4 w-4 text-blue-500" /> {t("reassign")}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={handleEscalate} className="gap-2">
                        <TrendingUp className="h-4 w-4 text-orange-500" /> {t("escalatePriority")}
                      </DropdownMenuItem>
                    </>
                  )}
                  {canWrite && canDelete && <DropdownMenuSeparator />}
                  {canDelete && (
                    <DropdownMenuItem
                      onClick={() => setDeleteOpen(true)}
                      className="gap-2 text-destructive focus:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" /> {t("deleteTicket")}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )
        }
      >
        <MetricStrip>
          {resolutionMetric}
          {firstResponseMetric}
          {ageMetric}
          {messagesMetric}
          {csatMetric}
        </MetricStrip>
      </RecordHero>

      <RecordSections
        label={tR("sectionsLabel")}
        tabs={[
          {
            id: "conversation",
            label: tR("tabs.conversation"),
            icon: <MessageSquare aria-hidden />,
            count: ticket.messageCount ?? messages.length,
          },
          { id: "details", label: tR("tabs.details"), icon: <Info aria-hidden /> },
          { id: "tasks", label: tR("tabs.tasks"), icon: <ListChecks aria-hidden />, count: openTasks },
        ]}
        sections={[
          { tab: "conversation", column: "main", node: conversation },
          /*
            Where the ticket stands, for whoever is picking it up (audit rilievo
            S-05, its fourth part). First in the reference column because "whose
            move is it" decides whether this ticket gets opened at all. Renders
            nothing on a ticket nobody has written on.
          */
          ...(ticket.handoverSummary
            ? [{ tab: "details", column: "side" as const, node: <HandoverCard summary={ticket.handoverSummary} /> }]
            : []),
          {
            tab: "details",
            column: "side",
            node: (
              <PropertiesCard
                ticket={ticket}
                canWrite={canWrite}
                onStatusChange={handleStatusChange}
                onPriorityChange={handlePriorityChange}
                onReassign={() => setReassignOpen(true)}
              />
            ),
          },
          { tab: "details", column: "side", node: <SlaCard ticket={ticket} /> },
          { tab: "details", column: "side", node: <RequesterCard ticket={ticket} canWrite={canWrite} /> },
          { tab: "details", column: "side", node: <CustomerHistoryCard ticket={ticket} /> },
          {
            tab: "details",
            column: "side",
            node: <OrderCard ticket={ticket} canWrite={canWrite} onLinked={() => void loadTicket()} />,
          },
          {
            tab: "tasks",
            column: "side",
            node: (
              <TasksCard
                ticketId={id}
                tasks={tasks}
                users={users}
                canWrite={canWrite}
                currentUserId={ticket.ownerId ?? undefined}
                onCreated={() => void loadTasks()}
                onUpdated={(updated) =>
                  setTasks((prev) => prev.map((tk) => (tk.id === updated.id ? { ...tk, ...updated } : tk)))
                }
              />
            ),
          },
          /*
            What this ticket resembles, from what the workspace has already
            answered (audit rilievo S-05). In the Conversation tab on a phone —
            under the reply box, which is where a suggested macro lands — and in
            the reference column on a desktop. Renders nothing when there is
            nothing to say.
          */
          {
            tab: "conversation",
            column: "side",
            node: (
              <TriageCard
                subject={ticket.subject}
                description={ticket.description}
                excludeId={ticket.id}
                onUseMacro={
                  canWrite
                    ? (macroId) => {
                        const macro = macros.find((m) => m.id === macroId);
                        if (macro) applyMacro(macro);
                      }
                    : undefined
                }
              />
            ),
          },
          ...(aiSummary
            ? [
                {
                  tab: "conversation",
                  column: "side" as const,
                  node: <AiSummaryCard subject={{ type: "ticket", id: ticket.id }} entry={aiSummary} />,
                },
              ]
            : []),
          // The files the thread carries, beside it.
          { tab: "conversation", column: "side", node: <AttachmentsCard docs={Object.values(ticketDocs)} /> },
        ]}
      />

      {/* ── Reassign dialog ─────────────────────────────────────────────── */}
      <Dialog open={reassignOpen} onOpenChange={setReassignOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserCheck className="h-5 w-5 text-blue-500" /> {t("reassignTitle")}
            </DialogTitle>
            <DialogDescription>{t("reassignDescription")}</DialogDescription>
          </DialogHeader>
          <AssigneeSelect value={selectedAssignee} onChange={setSelectedAssignee} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReassignOpen(false)}>
              {t("cancel")}
            </Button>
            <Button onClick={handleReassign} disabled={reassigning}>
              {reassigning ? t("detail.reassigning") : t("reassign")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete dialog ───────────────────────────────────────────────── */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" /> {t("deleteTicket")}
            </DialogTitle>
            <DialogDescription>
              {t.rich("detail.deleteConfirm", {
                number: ticket.ticketNumber,
                strong: (chunks) => <span className="font-semibold text-foreground">{chunks}</span>,
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleting}>
              {t("cancel")}
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? t("detail.deleting") : t("detail.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </RecordPage>
  );
}
