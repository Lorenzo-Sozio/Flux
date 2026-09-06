"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Building2,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock,
  ExternalLink,
  FileText,
  Lock,
  Mail,
  MessageCircle,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Phone,
  Plus,
  Send,
  Shield,
  Trash2,
  TrendingUp,
  User,
  UserCheck,
  Users,
  Zap,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import {
  addTicketMessageAction,
  deleteTicketAction,
  escalateTicketAction,
  getCustomerTicketHistory,
  getMacros,
  getOrdersForTicket,
  getTicketById,
  linkTicketToOrderAction,
  reassignTicketAction,
  updateTicketAction,
} from "@/actions/support";
import { createTask, getAllUsers, getTasksByTicketId } from "@/actions/tasks";
import { AssigneeSelect, decodeAssignee, encodeAssignee } from "@/components/crm/assignee-select";
import { RichTextEditor } from "@/components/crm/rich-text-editor";
import { TaskModal } from "@/components/crm/task-modal";
import { TicketPriorityBadge } from "@/components/crm/ticket-priority-badge";
import { TicketStatusBadge } from "@/components/crm/ticket-status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ticketMacros } from "@/db/schema";
import { useCurrency } from "@/hooks/use-currency";
import { sanitizeEmailHtml } from "@/lib/sanitize-email-html";

import { HandoverCard } from "../_components/handover-card";
import { TriageCard } from "../_components/triage-card";

// ─── Row shapes ───────────────────────────────────────────────────────────────
//
// Derived from what the loaders actually return, rather than `any`. Every prop on
// this page was untyped, so a renamed column compiled fine and rendered blank.

type TicketRow = NonNullable<Awaited<ReturnType<typeof getTicketById>>>;
type TicketMessage = TicketRow["messages"][number];
type TicketAuditEntry = TicketRow["auditLogs"][number];
type TicketDocument = { id: string; name: string; url: string; mimeType?: string | null; size?: number | null };
type TicketMacro = typeof ticketMacros.$inferSelect;
type PresenceEntry = { userId?: string; userName?: string; typing?: boolean; action?: string };
type TicketStatus = NonNullable<Parameters<typeof updateTicketAction>[1]["status"]>;
type TicketPriority = NonNullable<Parameters<typeof updateTicketAction>[1]["priority"]>;

/** The message from a caught value, which is `unknown` and not an Error. */
function messageOf(err: unknown, fallback = "Errore"): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CHANNEL_ICONS: Record<string, React.ReactNode> = {
  email: <Mail className="h-3.5 w-3.5" />,
  chat: <MessageCircle className="h-3.5 w-3.5" />,
  phone: <Phone className="h-3.5 w-3.5" />,
  social: <Users className="h-3.5 w-3.5" />,
};

const STATUS_OPTIONS = [
  { value: "new", color: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
  { value: "open", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  {
    value: "in_progress",
    color: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  },
  {
    value: "waiting",
    color: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  },
  {
    value: "on_hold",
    color: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  },
  {
    value: "resolved",
    color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  },
  { value: "closed", color: "bg-muted text-muted-foreground" },
];

const PRIORITY_OPTIONS = [
  { value: "urgent", color: "text-red-600 dark:text-red-400" },
  { value: "high", color: "text-orange-600 dark:text-orange-400" },
  { value: "normal", color: "text-blue-600 dark:text-blue-400" },
  { value: "low", color: "text-slate-500" },
];

const PRIORITY_DOT: Record<string, string> = {
  blocker: "bg-red-600",
  critical: "bg-orange-500",
  high: "bg-red-400",
  normal: "bg-blue-500",
  low: "bg-slate-400",
};

// Values only: the words come from the message files, like every other list here.
const TASK_PRIORITY_OPTIONS = ["normal", "high", "critical", "blocker", "low"] as const;

const AUDIT_LABELS: Record<string, string> = {
  created: "Ticket creato",
  status_changed: "Stato modificato",
  priority_changed: "Priorità modificata",
  assigned: "Assegnatario cambiato",
  message_added: "Messaggio aggiunto",
  field_changed: "Campo aggiornato",
};

const AVATAR_PALETTE = [
  "from-violet-500 to-violet-700",
  "from-blue-500 to-blue-700",
  "from-emerald-500 to-emerald-700",
  "from-rose-500 to-rose-700",
  "from-indigo-500 to-indigo-700",
  "from-cyan-500 to-cyan-700",
  "from-amber-500 to-amber-700",
];

type LinkedTask = Awaited<ReturnType<typeof getTasksByTicketId>>[number];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function avatarColor(name: string) {
  const h = [...name].reduce((a, c) => a + c.charCodeAt(0), 0);
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

function formatStamp(date: Date) {
  const now = Date.now();
  const diff = now - date.getTime();
  if (diff < 60_000) return "Adesso";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m fa`;
  if (diff < 86_400_000) return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── LinkedTasksCard ──────────────────────────────────────────────────────────

function LinkedTasksCard({ ticketId, currentUserId }: { ticketId: string; currentUserId?: string }) {
  const t = useTranslations("support.tickets");
  const [tasks, setTasks] = useState<LinkedTask[]>([]);
  const [users, setUsers] = useState<{ id: string; name: string | null }[]>([]);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const { register, handleSubmit, reset } = useForm<{ title: string; priority: string; dueDate: string }>({
    defaultValues: { priority: "normal", dueDate: "", title: "" },
  });

  const load = () => getTasksByTicketId(ticketId).then(setTasks).catch(console.error);

  useEffect(() => {
    getTasksByTicketId(ticketId).then(setTasks).catch(console.error);
    getAllUsers().then(setUsers).catch(console.error);
  }, [ticketId]);

  const onSubmit = async (data: { title: string; priority: string; dueDate: string }) => {
    if (!data.title.trim()) return;
    setSaving(true);
    try {
      await createTask({
        title: data.title.trim(),
        priority: data.priority,
        dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
        ticketId,
      });
      reset();
      setAdding(false);
      load();
    } catch {
      toast.error(t("taskCreateFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="px-3 pt-3 pb-2">
        <CardTitle className="flex items-center justify-between font-semibold text-muted-foreground text-xs uppercase tracking-wide">
          <span className="flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Attività
            {tasks.length > 0 && (
              <span className="rounded-full bg-muted px-1.5 py-0.5 font-normal text-[10px] normal-case tracking-normal">
                {tasks.length}
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="flex items-center gap-0.5 font-medium text-xs normal-case tracking-normal transition-colors hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" /> {t("newLabel")}
          </button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 px-3 pb-3">
        {adding && (
          <form onSubmit={handleSubmit(onSubmit)} className="mb-2 space-y-2 rounded-lg border bg-muted/30 p-2.5">
            <Input {...register("title")} placeholder="Titolo attività…" className="h-8 text-sm" autoFocus />
            <div className="flex gap-2">
              <select
                {...register("priority")}
                className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {TASK_PRIORITY_OPTIONS.map((o) => (
                  <option key={o} value={o}>
                    {t(`taskPriority.${o}`)}
                  </option>
                ))}
              </select>
              <input
                type="date"
                {...register("dueDate")}
                className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="flex justify-end gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setAdding(false);
                  reset();
                }}
                className="rounded px-2 py-1 text-muted-foreground text-xs hover:text-foreground"
              >
                {t("cancel")}
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded bg-primary px-3 py-1 font-semibold text-primary-foreground text-xs hover:bg-primary/90 disabled:opacity-50"
              >
                {saving ? "…" : "Crea"}
              </button>
            </div>
          </form>
        )}
        {tasks.length === 0 && !adding && <p className="py-1 text-muted-foreground text-sm italic">{t("noTasks")}</p>}
        {tasks.map((task) => {
          const done = task.status === "done";
          return (
            <div
              key={task.id}
              className="group flex items-start gap-2 rounded-md p-1.5 transition-colors hover:bg-muted/50"
            >
              {done ? (
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
              ) : (
                <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0 flex-1">
                <p
                  className={`truncate font-medium text-sm leading-snug ${done ? "text-muted-foreground line-through" : ""}`}
                >
                  {task.title}
                </p>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${PRIORITY_DOT[task.priority] ?? PRIORITY_DOT.normal}`}
                  />
                  {task.dueDate && (
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {new Date(task.dueDate).toLocaleDateString(undefined, { day: "2-digit", month: "short" })}
                    </span>
                  )}
                  {task.assigneeName && (
                    <span className="truncate text-muted-foreground text-xs">{task.assigneeName}</span>
                  )}
                </div>
              </div>
              <TaskModal
                task={task}
                users={users}
                currentUserId={currentUserId}
                revalidatePathStr={`/dashboard/support/tickets/${ticketId}`}
                onUpdated={(updated) =>
                  setTasks((prev) => prev.map((t) => (t.id === updated.id ? { ...t, ...updated } : t)))
                }
              />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ─── SLATimer ─────────────────────────────────────────────────────────────────

function SLATimer({ targetDate }: { targetDate: Date | null }) {
  const [remaining, setRemaining] = useState<string | null>(null);
  const [isOverdue, setIsOverdue] = useState(false);

  useEffect(() => {
    if (!targetDate) return;
    const update = () => {
      const diff = new Date(targetDate).getTime() - Date.now();
      if (diff <= 0) {
        setIsOverdue(true);
        const ms = Math.abs(diff);
        setRemaining(`${Math.floor(ms / 3_600_000)}h ${Math.floor((ms % 3_600_000) / 60_000)}m in ritardo`);
      } else {
        setIsOverdue(false);
        setRemaining(`${Math.floor(diff / 3_600_000)}h ${Math.floor((diff % 3_600_000) / 60_000)}m`);
      }
    };
    update();
    const t = setInterval(update, 60_000);
    return () => clearInterval(t);
  }, [targetDate]);

  if (!targetDate || !remaining) return <span className="text-muted-foreground text-sm">—</span>;
  return (
    <span
      className={`font-mono font-semibold text-sm tabular-nums ${isOverdue ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}
    >
      {isOverdue && <AlertTriangle className="mr-1 inline h-3 w-3" />}
      {remaining}
    </span>
  );
}

// ─── Timeline sub-components ──────────────────────────────────────────────────

function AuditEvent({ entry }: { entry: TicketAuditEntry }) {
  const actor = entry.actor?.name ?? entry.actorName ?? "Sistema";
  const label = AUDIT_LABELS[entry.action] ?? entry.action;
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="h-px flex-1 bg-border" />
      <div className="flex items-center gap-1.5 whitespace-nowrap text-muted-foreground text-xs">
        <Activity className="h-2.5 w-2.5 shrink-0" />
        <span className="font-medium">{actor}</span>
        <span>·</span>
        <span>{label}</span>
        {entry.oldValue && entry.newValue && (
          <span className="flex items-center gap-1">
            <span className="line-through opacity-60">{entry.oldValue}</span>
            <span>→</span>
            <span className="font-medium">{entry.newValue}</span>
          </span>
        )}
        <span>·</span>
        <span>{formatStamp(new Date(entry.createdAt))}</span>
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
            className="flex items-center gap-1.5 rounded-md border bg-background/80 px-2 py-1 text-xs transition-colors hover:bg-muted"
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

function MessageBubble({ msg, docs, isAgent }: { msg: TicketMessage; docs?: TicketDocument[]; isAgent: boolean }) {
  const t = useTranslations("support.tickets");
  const senderName = msg.sender?.name ?? msg.senderName ?? msg.senderEmail?.split("@")[0] ?? "Sconosciuto";
  const isInternal = !msg.isPublic;
  const stamp = formatStamp(new Date(msg.createdAt));

  if (isInternal) {
    return (
      <div className="rounded-xl border border-amber-200/60 bg-amber-50/70 px-4 py-3 dark:border-amber-800/30 dark:bg-amber-950/20">
        <div className="mb-1.5 flex items-center gap-2">
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
        {msg.content?.startsWith("<") ? (
          <div
            className="prose prose-sm dark:prose-invert max-w-none prose-p:text-amber-900 text-sm leading-relaxed dark:prose-p:text-amber-100"
            // Message bodies arrive from inbound customer email: this is markup written by a
            // stranger, rendered inside an authenticated agent's session.
            //
            // Two independent things stop that being stored XSS, and it needs to stay two.
            // `sanitizeEmailHtml` removes what executes without needing an HTML parser, which
            // matters because jsdom does not run on Workers and the bundle is already near the
            // 10 MB limit. Behind it the Content-Security-Policy in src/proxy.ts still holds the
            // line: no `unsafe-inline` in script-src, `frame-src 'none'`, `form-action 'self'`,
            // `img-src 'self' data: blob:`.
            //
            // WARN The sanitiser is a denylist, so it is only ever as good as its list. Do not
            // weaken the CSP on the strength of it.
            // biome-ignore lint/security/noDangerouslySetInnerHtml: email HTML by definition; sanitised
            dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(msg.content ?? "") }}
          />
        ) : (
          <p className="whitespace-pre-wrap text-amber-900 text-sm leading-relaxed dark:text-amber-100">
            {msg.content}
          </p>
        )}
        <AttachmentChips docs={docs ?? []} />
      </div>
    );
  }

  if (isAgent) {
    return (
      <div className="flex justify-end gap-3">
        <div className="min-w-0 max-w-[85%]">
          <div className="mb-1 flex items-center justify-end gap-2">
            {msg.channel && <span className="text-muted-foreground/60">{CHANNEL_ICONS[msg.channel]}</span>}
            <span className="text-muted-foreground/70 text-xs">{stamp}</span>
            <span className="font-semibold text-sm">{senderName}</span>
          </div>
          <div className="rounded-2xl rounded-tr-sm border border-primary/12 bg-primary/8 px-4 py-3 dark:bg-primary/12">
            {msg.content?.startsWith("<") ? (
              <div
                className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed"
                // biome-ignore lint/security/noDangerouslySetInnerHtml: email HTML by definition; sanitised
                dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(msg.content ?? "") }}
              />
            ) : (
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</p>
            )}
            <AttachmentChips docs={docs ?? []} />
          </div>
        </div>
        <div
          className={`mt-1 flex h-7 w-7 shrink-0 items-center justify-center self-start rounded-full bg-gradient-to-br font-bold text-[10px] text-white ${avatarColor(senderName)}`}
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
        className={`mt-1 flex h-7 w-7 shrink-0 items-center justify-center self-start rounded-full bg-gradient-to-br font-bold text-[10px] text-white ${avatarColor(senderName)}`}
      >
        {initials(senderName)}
      </div>
      <div className="min-w-0 max-w-[85%]">
        <div className="mb-1 flex items-center gap-2">
          <span className="font-semibold text-sm">{senderName}</span>
          {msg.senderEmail && <span className="text-muted-foreground/70 text-xs">&lt;{msg.senderEmail}&gt;</span>}
          {msg.channel && <span className="text-muted-foreground/60">{CHANNEL_ICONS[msg.channel]}</span>}
          <span className="text-muted-foreground/70 text-xs">{stamp}</span>
        </div>
        <div className="rounded-2xl rounded-tl-sm border border-border/60 bg-muted/60 px-4 py-3">
          {msg.content?.startsWith("<") ? (
            <div
              className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: email HTML by definition; sanitised
              dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(msg.content ?? "") }}
            />
          ) : (
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</p>
          )}
          <AttachmentChips docs={docs ?? []} />
        </div>
      </div>
    </div>
  );
}

// ─── Sidebar cards ────────────────────────────────────────────────────────────

/**
 * Which order this conversation is about.
 *
 * Support and sales did not touch anywhere. An agent reading "my order has not
 * arrived" had nowhere to record which one, so the answer stayed in the prose of
 * the message where no query can reach it, and the order never learned that
 * somebody had complained about it.
 *
 * The list is the customer's own orders, not the workspace's: "which of their
 * orders" is the question, and offering all of them invites the wrong answer.
 */
/**
 * Whether this customer has been here before.
 *
 * A first ticket and a fourth in a month are different conversations, and
 * answering the second as though it were the first is how somebody decides
 * nobody is listening. The sidebar said who they are and never whether they had
 * written before.
 */
function HistoryCard({ ticket }: { ticket: TicketRow }) {
  const t = useTranslations("support.tickets");
  const [history, setHistory] = useState<Awaited<ReturnType<typeof getCustomerTicketHistory>> | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the ticket is the trigger
  useEffect(() => {
    let current = true;
    getCustomerTicketHistory(ticket.id)
      .then((h) => current && setHistory(h))
      .catch(() => current && setHistory(null));
    return () => {
      current = false;
    };
  }, [ticket.id]);

  // Nothing to say is said by saying nothing: a card reading "0 previous" on a
  // first-time customer is noise on every new ticket.
  if (!history || history.total === 0) return null;

  return (
    <Card>
      <CardHeader className="px-3 pt-3 pb-2">
        <CardTitle className="font-semibold text-[11px] text-muted-foreground uppercase tracking-wide">
          {t("customerHistory")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 px-3 pb-3">
        <p className="text-muted-foreground text-xs">
          {history.open > 0
            ? t("historySummaryOpen", { total: history.total, open: history.open })
            : t("historySummary", { total: history.total })}
        </p>
        <div className="space-y-1">
          {history.recent.map((h) => (
            <Link
              key={h.id}
              href={`/dashboard/support/tickets/${h.id}`}
              className="flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 transition-colors hover:bg-muted/40"
            >
              <span className="truncate text-xs">{h.subject}</span>
              <span className="shrink-0 text-[10px] text-muted-foreground capitalize">
                {h.status.replace(/_/g, " ")}
              </span>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function OrderCard({ ticket, onLinked }: { ticket: TicketRow; onLinked: () => void }) {
  const t = useTranslations("support.tickets");
  const { formatAmount } = useCurrency();
  const [orders, setOrders] = useState<Awaited<ReturnType<typeof getOrdersForTicket>>>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Asked for when the card is opened to, not on every ticket that is read.
  function load() {
    if (orders.length > 0 || loading) return;
    setLoading(true);
    getOrdersForTicket(ticket.id)
      .then(setOrders)
      .catch(() => setOrders([]))
      .finally(() => setLoading(false));
  }

  async function choose(value: string) {
    setSaving(true);
    try {
      await linkTicketToOrderAction(ticket.id, value === "__none__" ? null : value);
      onLinked();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("orderLinkFailed"));
    } finally {
      setSaving(false);
    }
  }

  if (!ticket.companyId && !ticket.contactId) return null;

  return (
    <Card>
      <CardHeader className="px-3 pt-3 pb-2">
        <CardTitle className="font-semibold text-[11px] text-muted-foreground uppercase tracking-wide">
          {t("aboutOrder")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 px-3 pb-3">
        {ticket.order && (
          <Link
            href={`/dashboard/sales/orders/${ticket.order.id}`}
            className="flex items-center justify-between rounded-md border px-2 py-1.5 transition-colors hover:bg-muted/40"
          >
            <span className="truncate font-medium text-xs">{ticket.order.orderNumber}</span>
            <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
              {formatAmount(Number(ticket.order.totalAmount ?? 0))}
            </span>
          </Link>
        )}

        <Select
          value={ticket.orderId ?? "__none__"}
          onValueChange={choose}
          disabled={saving}
          onOpenChange={(open) => open && load()}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder={t("chooseOrder")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">{t("noOrder")}</SelectItem>
            {orders.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.orderNumber} · {o.status}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {loading && <p className="text-[11px] text-muted-foreground">{t("loadingOrders")}</p>}
        {!loading && orders.length === 0 && ticket.orderId === null && (
          <p className="text-[11px] text-muted-foreground">{t("noOrdersForCustomer")}</p>
        )}
      </CardContent>
    </Card>
  );
}

function ContactCard({ ticket }: { ticket: TicketRow }) {
  const t = useTranslations("support.tickets");
  const contact = ticket.contact;
  if (!contact) {
    return (
      <Card>
        <CardContent className="px-3 py-3">
          <p className="text-muted-foreground text-xs italic">{t("noContactLinked")}</p>
        </CardContent>
      </Card>
    );
  }
  const name = `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() || "—";
  return (
    <Card>
      <CardHeader className="px-3 pt-3 pb-2">
        <CardTitle className="flex items-center gap-1.5 font-semibold text-muted-foreground text-xs uppercase tracking-wide">
          <User className="h-3.5 w-3.5" /> {t("customer")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2.5 px-3 pb-3">
        <div className="flex items-center gap-2.5">
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br font-bold text-white text-xs ${avatarColor(name)}`}
          >
            {initials(name)}
          </div>
          <div className="min-w-0">
            <p className="truncate font-semibold text-sm">{name}</p>
            {contact.email && <p className="truncate text-muted-foreground text-sm">{contact.email}</p>}
          </div>
        </div>
        {contact.phone && (
          <div className="flex items-center gap-1.5 text-muted-foreground text-sm">
            <Phone className="h-3.5 w-3.5 shrink-0" />
            {contact.phone}
          </div>
        )}
        {ticket.company && (
          <div className="flex items-center gap-1.5 border-t pt-2 text-muted-foreground text-sm">
            <Building2 className="h-3.5 w-3.5 shrink-0" />
            <span className="font-medium text-foreground">{ticket.company.name}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PropertiesCard({
  ticket,
  onStatusChange,
  onPriorityChange,
  onReassign,
}: {
  ticket: TicketRow;
  onStatusChange: (s: TicketStatus) => void;
  onPriorityChange: (p: TicketPriority) => void;
  onReassign: () => void;
}) {
  const t = useTranslations("support.tickets");
  return (
    <Card>
      <CardHeader className="px-3 pt-3 pb-2">
        <CardTitle className="font-semibold text-muted-foreground text-xs uppercase tracking-wide">
          {t("properties")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 px-3 pb-3">
        {/* Status pills */}
        <div>
          <p className="mb-1.5 font-medium text-muted-foreground text-xs uppercase tracking-wide">{t("statusLabel")}</p>
          <div className="flex flex-wrap gap-1">
            {STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onStatusChange(opt.value as TicketStatus)}
                className={`rounded-full px-2.5 py-0.5 font-semibold text-xs transition-all ${
                  ticket.status === opt.value
                    ? `${opt.color} ring-1 ring-current/30 ring-inset`
                    : "bg-muted/50 text-muted-foreground hover:bg-muted"
                }`}
              >
                {t(
                  `statuses.${opt.value as "new" | "open" | "in_progress" | "waiting" | "on_hold" | "resolved" | "closed"}`,
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Priority */}
        <div>
          <p className="mb-1.5 font-medium text-muted-foreground text-xs uppercase tracking-wide">
            {t("priorityLabel")}
          </p>
          <div className="flex gap-1">
            {PRIORITY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onPriorityChange(opt.value as TicketPriority)}
                className={`rounded-full px-2.5 py-0.5 font-semibold text-xs transition-all ${
                  (ticket.priority ?? "normal") === opt.value
                    ? `bg-muted ${opt.color} ring-1 ring-current/20 ring-inset`
                    : "bg-muted/50 text-muted-foreground hover:bg-muted"
                }`}
              >
                {t(`priorities.${opt.value as "low" | "normal" | "high" | "urgent"}`)}
              </button>
            ))}
          </div>
        </div>

        {/* Assignee */}
        <div>
          <p className="mb-1.5 font-medium text-muted-foreground text-xs uppercase tracking-wide">{t("assignedTo")}</p>
          <button
            type="button"
            onClick={onReassign}
            className="group flex w-full items-center gap-2 rounded-lg border border-border/60 border-dashed px-2.5 py-1.5 transition-colors hover:border-primary/40 hover:bg-primary/5"
          >
            <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted">
              <User className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <span className="truncate font-medium text-sm">{ticket.assignee?.name ?? "Non assegnato"}</span>
            <MoreHorizontal className="ml-auto h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        </div>

        {/* SLA tier + severity */}
        {(ticket.sla || ticket.severity) && (
          <div className="flex flex-wrap gap-1.5 border-t pt-2.5">
            {ticket.sla && (
              <Badge variant="outline" className="text-xs">
                {ticket.sla.name}
              </Badge>
            )}
            {ticket.severity && ticket.severity !== "normal" && (
              <Badge variant="outline" className="text-xs capitalize">
                Severity: {ticket.severity}
              </Badge>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SLACard({
  ticket,
  slaFirstTarget,
  slaResTarget,
}: {
  ticket: TicketRow;
  slaFirstTarget: Date | null;
  slaResTarget: Date | null;
}) {
  const t = useTranslations("support.tickets");
  if (!ticket.sla && !ticket.firstResponseAt && !ticket.resolvedAt) return null;
  return (
    <Card>
      <CardHeader className="px-3 pt-3 pb-2">
        <CardTitle className="flex items-center gap-1.5 font-semibold text-muted-foreground text-xs uppercase tracking-wide">
          <Clock className="h-3.5 w-3.5" /> SLA
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 px-3 pb-3">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-sm">{t("firstResponse")}</span>
          {ticket.firstResponseAt ? (
            <span className="font-semibold text-emerald-600 text-sm dark:text-emerald-400">
              ✓ {new Date(ticket.firstResponseAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
            </span>
          ) : (
            <SLATimer targetDate={slaFirstTarget} />
          )}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-sm">{t("resolution")}</span>
          {ticket.resolvedAt ? (
            <span className="font-semibold text-emerald-600 text-sm dark:text-emerald-400">
              ✓ {new Date(ticket.resolvedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
            </span>
          ) : (
            <SLATimer targetDate={slaResTarget} />
          )}
        </div>
        {ticket.closedAt && (
          <div className="flex items-center justify-between border-t pt-2">
            <span className="text-muted-foreground text-sm">{t("closedLabel")}</span>
            <span className="font-mono text-sm">
              {new Date(ticket.closedAt).toLocaleDateString(undefined, {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AttachmentsCard({ docs }: { docs: TicketDocument[] }) {
  const t = useTranslations("support.tickets");
  return (
    <Card>
      <CardHeader className="px-3 pt-3 pb-2">
        <CardTitle className="flex items-center gap-1.5 font-semibold text-muted-foreground text-xs uppercase tracking-wide">
          <Paperclip className="h-3.5 w-3.5" />
          Allegati
          {docs.length > 0 && (
            <span className="rounded-full bg-muted px-1.5 py-0.5 font-normal text-[10px] text-muted-foreground normal-case tracking-normal">
              {docs.length}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 px-3 pb-3">
        {docs.length === 0 ? (
          <p className="py-0.5 text-muted-foreground text-sm italic">{t("noAttachments")}</p>
        ) : (
          docs.map((doc) => {
            const isPdf = doc.mimeType === "application/pdf";
            return (
              <a
                key={doc.id}
                href={`/api/documents/${doc.id}${isPdf ? "?view=1" : ""}`}
                target={isPdf ? "_blank" : undefined}
                download={!isPdf ? doc.name : undefined}
                rel="noopener noreferrer"
                className="group flex items-center gap-2 rounded-md p-1.5 transition-colors hover:bg-muted/50"
              >
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-sm leading-snug group-hover:text-primary">{doc.name}</p>
                  {doc.size != null && <p className="text-muted-foreground text-xs">{formatBytes(doc.size)}</p>}
                </div>
                <ExternalLink className="h-3 w-3 text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100" />
              </a>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const t = useTranslations("support.tickets");
  const { id } = React.use(params);
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);

  const [ticket, setTicket] = useState<TicketRow | null>(null);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [auditLogs, setAuditLogs] = useState<TicketAuditEntry[]>([]);
  const [macros, setMacros] = useState<TicketMacro[]>([]);
  const [loading, setLoading] = useState(true);
  const [presence, setPresence] = useState<PresenceEntry[]>([]);
  const [ticketDocs, setTicketDocs] = useState<Record<string, TicketDocument>>({});

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
  const [selectedAssignee, setSelectedAssignee] = useState<string>("__none__");
  const [reassigning, setReassigning] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    });
  }, []);

  const loadTicket = useCallback(async () => {
    try {
      const [data, docsRes] = await Promise.all([
        getTicketById(id),
        fetch(`/api/documents?entityType=ticket&entityId=${id}`)
          .then((r) => r.json())
          .catch(() => ({ documents: [] })),
      ]);
      if (data) {
        setTicket(data);
        setMessages(
          [...(data.messages ?? [])].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
        );
        setAuditLogs(
          [...(data.auditLogs ?? [])].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
        );
        setSelectedAssignee(encodeAssignee(data.assigneeId, null));
      }
      const docsById: Record<string, TicketDocument> = {};
      for (const doc of docsRes.documents ?? []) docsById[doc.id] = doc;
      setTicketDocs(docsById);
    } catch (e) {
      console.error("Failed to load ticket:", e);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadTicket();
    getMacros().then(setMacros).catch(console.error);
  }, [loadTicket]);
  useEffect(() => {
    if (!loading) scrollToBottom();
  }, [loading, scrollToBottom]);
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
        toast.info(`Ticket chiuso — nuovo ticket ${result.newTicketNumber} creato`);
        router.push(`/dashboard/support/tickets/${result.newTicketId}`);
        return;
      }
      setReplyContent("<p></p>");
      await loadTicket();
      scrollToBottom();
    } catch (err) {
      toast.error(messageOf(err, "Invio fallito"));
    } finally {
      setSending(false);
    }
  }, [id, isInternal, isReplyEmpty, loadTicket, replyContent, router, scrollToBottom, ticket?.channel]);

  const handleStatusChange = useCallback(
    async (status: TicketStatus) => {
      try {
        await updateTicketAction(id, { status });
        setTicket((p) => (p ? { ...p, status } : p));
        toast.success(t("statusUpdated"));
      } catch (err) {
        toast.error(messageOf(err));
      }
    },
    [id, t],
  );

  const handlePriorityChange = useCallback(
    async (priority: TicketPriority) => {
      try {
        await updateTicketAction(id, { priority });
        setTicket((p) => (p ? { ...p, priority } : p));
        toast.success(t("priorityUpdated"));
      } catch (err) {
        toast.error(messageOf(err));
      }
    },
    [id, t],
  );

  const handleEscalate = useCallback(async () => {
    try {
      const result = await escalateTicketAction(id);
      if (result.alreadyMaxPriority) {
        toast.info(t("priorityAlreadyMax"));
        return;
      }
      setTicket((p) => (p && result.newPriority ? { ...p, priority: result.newPriority } : p));
      toast.success(`Priorità escalata a ${result.newPriority}`);
    } catch (err) {
      toast.error(messageOf(err));
    }
  }, [id, t]);

  const handleReassign = useCallback(async () => {
    setReassigning(true);
    try {
      const { ownerId } = decodeAssignee(selectedAssignee);
      await reassignTicketAction(id, ownerId);
      await loadTicket();
      setReassignOpen(false);
      toast.success(ownerId ? "Ticket riassegnato" : "Assegnatario rimosso");
    } catch (err) {
      toast.error(messageOf(err));
    } finally {
      setReassigning(false);
    }
  }, [id, loadTicket, selectedAssignee]);

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    try {
      await deleteTicketAction(id);
      toast.success(t("deleted"));
      router.push("/dashboard/support/tickets");
    } catch (err) {
      toast.error(messageOf(err));
      setDeleting(false);
      setDeleteOpen(false);
    }
  }, [id, router, t]);

  const slaFirstTarget =
    ticket?.sla && !ticket.firstResponseAt
      ? new Date(new Date(ticket.createdAt).getTime() + ticket.sla.firstResponseTimeMinutes * 60_000)
      : null;
  const slaResTarget =
    ticket?.sla && !ticket.resolvedAt
      ? new Date(new Date(ticket.createdAt).getTime() + ticket.sla.resolutionTimeMinutes * 60_000)
      : null;

  // Build chronological timeline merging messages + audit events
  const timeline = [
    ...messages.map((m) => ({ type: "message" as const, ts: new Date(m.createdAt).getTime(), data: m })),
    ...auditLogs.map((a) => ({ type: "audit" as const, ts: new Date(a.createdAt).getTime(), data: a })),
  ].sort((a, b) => a.ts - b.ts);

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex animate-pulse flex-col gap-0 p-6">
        <div className="mb-6 h-4 w-28 rounded bg-muted" />
        <div className="mb-3 h-7 w-96 rounded bg-muted" />
        <div className="mb-6 h-4 w-64 rounded bg-muted" />
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="space-y-3 lg:col-span-2">
            <div className="h-80 rounded-xl bg-muted" />
            <div className="h-40 rounded-xl bg-muted" />
          </div>
          <div className="space-y-3">
            <div className="h-28 rounded-xl bg-muted" />
            <div className="h-48 rounded-xl bg-muted" />
            <div className="h-24 rounded-xl bg-muted" />
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
          <Link href="/dashboard/support/tickets">← Torna ai ticket</Link>
        </Button>
      </div>
    );
  }

  const typingUsers = presence.filter((p) => p.action === "typing");

  return (
    <>
      {/* Cancel parent vertical padding only, fill viewport below the 3rem app header */}
      <div className="-my-4 md:-my-6 flex flex-col overflow-hidden" style={{ height: "calc(100dvh - 3rem)" }}>
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="shrink-0 border-b bg-background px-6 pt-5 pb-4">
          {/* Breadcrumb + actions */}
          <div className="mb-3 flex items-center justify-between gap-4">
            <Link
              href="/dashboard/support/tickets"
              className="inline-flex items-center gap-1.5 font-medium text-muted-foreground text-sm transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> {t("allTickets")}
            </Link>
            <div className="flex items-center gap-2">
              <span className="font-mono font-semibold text-muted-foreground text-xs">{ticket.ticketNumber}</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 gap-1">
                    {t("actions")} <ChevronDown className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem onClick={handleEscalate} className="gap-2">
                    <TrendingUp className="h-4 w-4 text-orange-500" /> {t("escalatePriority")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setReassignOpen(true)} className="gap-2">
                    <UserCheck className="h-4 w-4 text-blue-500" /> {t("reassign")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => setDeleteOpen(true)}
                    className="gap-2 text-destructive focus:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" /> {t("deleteTicket")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Title */}
          <h1 className="mb-2 font-bold text-2xl leading-tight tracking-tight">{ticket.subject}</h1>

          {/* Meta row */}
          <div className="flex flex-wrap items-center gap-2">
            <TicketStatusBadge status={ticket.status} />
            <TicketPriorityBadge priority={ticket.priority} />
            <Badge variant="outline" className="h-5 gap-1 text-xs">
              {CHANNEL_ICONS[ticket.channel]}
              <span className="capitalize">{ticket.channel}</span>
            </Badge>
            {ticket.severity && ticket.severity !== "normal" && (
              <Badge variant="outline" className="h-5 text-xs capitalize">
                Severity: {ticket.severity}
              </Badge>
            )}
            {ticket.tags?.map((tag: string) => (
              <Badge key={tag} variant="secondary" className="h-5 text-xs">
                {tag}
              </Badge>
            ))}
            <span className="ml-1 flex items-center gap-1 text-muted-foreground text-xs">
              <Clock className="h-3.5 w-3.5" />
              {new Date(ticket.createdAt).toLocaleString(undefined, {
                day: "numeric",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
        </div>

        {/* ── Body grid ───────────────────────────────────────────────────── */}
        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1fr_300px]">
          {/* ── Left: Conversation ──────────────────────────────────────── */}
          <div className="flex min-h-0 flex-col border-r">
            {/* Typing presence banner */}
            {typingUsers.length > 0 && (
              <div className="flex items-center gap-2 border-b bg-amber-50/80 px-6 py-2 text-amber-700 text-xs dark:border-amber-800/30 dark:bg-amber-950/20 dark:text-amber-400">
                <span className="flex gap-0.5">
                  {[0, 150, 300].map((d) => (
                    <span
                      key={d}
                      className="h-1.5 w-1.5 animate-bounce rounded-full bg-amber-500"
                      style={{ animationDelay: `${d}ms` }}
                    />
                  ))}
                </span>
                {typingUsers.map((p) => p.userName).join(", ")} sta scrivendo…
              </div>
            )}

            {/* Timeline */}
            <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
              {timeline.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <MessageSquare className="mb-3 h-10 w-10 text-muted-foreground/20" />
                  <p className="text-muted-foreground text-sm">{t("noMessages")}</p>
                  <p className="mt-1 text-muted-foreground/60 text-xs">{t("sendFirstReply")}</p>
                </div>
              ) : (
                timeline.map((item, i) => {
                  if (item.type === "audit") {
                    return <AuditEvent key={`audit-${item.data.id}-${i}`} entry={item.data} />;
                  }
                  const msg = item.data;
                  const isAgent = !!msg.sender;
                  const msgDocs = (msg.attachmentIds ?? []).map((docId: string) => ticketDocs[docId]).filter(Boolean);
                  return <MessageBubble key={msg.id ?? i} msg={msg} docs={msgDocs} isAgent={isAgent} />;
                })
              )}
            </div>

            {/* ── Reply area ──────────────────────────────────────────── */}
            <div
              className={`shrink-0 space-y-3 border-t p-4 ${isInternal ? "bg-amber-50/40 dark:bg-amber-950/10" : "bg-background"}`}
            >
              {/* Public / Internal toggle */}
              <div className="flex w-fit items-center gap-1 rounded-lg border bg-muted/40 p-0.5">
                {[
                  { val: false, icon: Send, label: "Risposta pubblica" },
                  { val: true, icon: Lock, label: t("internalNote") },
                ].map(({ val, icon: Icon, label }) => (
                  <button
                    key={String(val)}
                    type="button"
                    onClick={() => setIsInternal(val)}
                    className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium text-sm transition-all ${
                      isInternal === val
                        ? val
                          ? "bg-amber-100 text-amber-700 shadow-sm dark:bg-amber-900/40 dark:text-amber-300"
                          : "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Icon className="h-3 w-3" />
                    {label}
                  </button>
                ))}
              </div>

              {/* Editor.
                  The wrapper carries the Ctrl+Enter shortcut for the editor inside it;
                  it is not itself a control, and giving it a role or a tab stop would
                  put an extra, meaningless stop in the tab order. */}
              {/* biome-ignore lint/a11y/noStaticElementInteractions: keyboard shortcut for the focusable editor within */}
              <div
                onKeyDown={(e) => {
                  if (e.ctrlKey && e.key === "Enter") {
                    e.preventDefault();
                    handleSendReply();
                  }
                }}
              >
                <RichTextEditor
                  value={replyContent}
                  onChange={(html) => {
                    setReplyContent(html);
                    fetch(`/api/tickets/${id}/presence`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action: "typing" }),
                      // A failed presence ping must not interrupt the agent's reply.
                      // biome-ignore lint/suspicious/noEmptyBlockStatements: fire-and-forget
                    }).catch(() => {});
                  }}
                  placeholder={
                    isInternal ? "Scrivi una nota interna (visibile solo al team)…" : "Scrivi una risposta al cliente…"
                  }
                  className={isInternal ? "border-amber-300 dark:border-amber-700" : ""}
                  macroVariables
                />
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between">
                <p className="flex items-center gap-1 text-muted-foreground text-xs">
                  {isInternal ? (
                    <>
                      <Shield className="h-3 w-3" /> {t("agentsOnly")}
                    </>
                  ) : (
                    <>Ctrl+Enter per inviare</>
                  )}
                </p>
                <div className="flex items-center gap-2">
                  {macros.length > 0 && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="h-8 gap-1.5">
                          <Zap className="h-3.5 w-3.5" /> {t("macro")}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="max-h-60 w-52 overflow-y-auto">
                        {macros.map((macro) => (
                          <DropdownMenuItem
                            key={macro.id}
                            className="flex flex-col items-start gap-0.5 py-2"
                            onClick={() => applyMacro(macro)}
                          >
                            <span className="font-medium text-sm">{macro.name}</span>
                            {macro.description && (
                              <span className="w-full truncate text-muted-foreground text-xs">{macro.description}</span>
                            )}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8"
                    onClick={() => setReplyContent("<p></p>")}
                    disabled={isReplyEmpty}
                  >
                    {t("clear")}
                  </Button>
                  <Button
                    size="sm"
                    className="h-8 gap-1.5"
                    onClick={handleSendReply}
                    disabled={isReplyEmpty || sending}
                  >
                    <Send className="h-3.5 w-3.5" />
                    {sending ? "Invio…" : isInternal ? "Aggiungi nota" : "Invia risposta"}
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* ── Right: Sidebar ──────────────────────────────────────────── */}
          <div className="space-y-3 overflow-y-auto p-4">
            <ContactCard ticket={ticket} />
            {/*
              Where the ticket stands, for whoever is picking it up (audit rilievo
              S-05, its fourth part). First in the column because "whose move is
              it" decides whether this ticket gets opened at all, and it is read
              before anything else on the page.
            */}
            <HandoverCard
              messages={messages.map((m) => ({
                id: m.id,
                senderId: m.senderId ?? null,
                senderName: m.sender?.name ?? m.senderName ?? null,
                isPublic: m.isPublic,
                content: m.content,
                createdAt: new Date(m.createdAt),
              }))}
            />
            {/*
              What this ticket resembles, from what the workspace has already
              answered (audit rilievo S-05). Above the history because it is the
              thing somebody picking the ticket up wants first, and it renders
              nothing at all when there is nothing to say.
            */}
            <TriageCard
              subject={ticket.subject}
              description={ticket.description}
              excludeId={ticket.id}
              onUseMacro={(macroId) => {
                const macro = macros.find((m) => m.id === macroId);
                if (macro) applyMacro(macro);
              }}
            />
            <OrderCard ticket={ticket} onLinked={() => void loadTicket()} />
            <HistoryCard ticket={ticket} />
            <PropertiesCard
              ticket={ticket}
              onStatusChange={handleStatusChange}
              onPriorityChange={handlePriorityChange}
              onReassign={() => setReassignOpen(true)}
            />
            <SLACard ticket={ticket} slaFirstTarget={slaFirstTarget} slaResTarget={slaResTarget} />
            <LinkedTasksCard ticketId={id} currentUserId={ticket?.ownerId ?? undefined} />
            <AttachmentsCard docs={Object.values(ticketDocs)} />
          </div>
        </div>
      </div>

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
              {reassigning ? "Riassegno…" : t("reassign")}
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
              {t("deleteConfirm")} <span className="font-semibold text-foreground">{ticket.ticketNumber}</span>? Questa
              azione rimuoverà permanentemente il ticket e tutti i suoi messaggi.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleting}>
              {t("cancel")}
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? "Eliminazione…" : "Elimina"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
