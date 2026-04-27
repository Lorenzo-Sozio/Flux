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
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import {
  addTicketMessageAction,
  deleteTicketAction,
  escalateTicketAction,
  getMacros,
  getTicketById,
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

// ─── Constants ────────────────────────────────────────────────────────────────

const CHANNEL_ICONS: Record<string, React.ReactNode> = {
  email: <Mail className="h-3.5 w-3.5" />,
  chat: <MessageCircle className="h-3.5 w-3.5" />,
  phone: <Phone className="h-3.5 w-3.5" />,
  social: <Users className="h-3.5 w-3.5" />,
};

const STATUS_OPTIONS = [
  { value: "new",         label: "Nuovo",       color: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
  { value: "open",        label: "Aperto",      color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  { value: "in_progress", label: "In corso",    color: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300" },
  { value: "waiting",     label: "In attesa",   color: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  { value: "on_hold",     label: "Sospeso",     color: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300" },
  { value: "resolved",    label: "Risolto",     color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  { value: "closed",      label: "Chiuso",      color: "bg-muted text-muted-foreground" },
];

const PRIORITY_OPTIONS = [
  { value: "urgent", label: "Urgente", color: "text-red-600 dark:text-red-400" },
  { value: "high",   label: "Alta",    color: "text-orange-600 dark:text-orange-400" },
  { value: "normal", label: "Normale", color: "text-blue-600 dark:text-blue-400" },
  { value: "low",    label: "Bassa",   color: "text-slate-500" },
];

const PRIORITY_DOT: Record<string, string> = {
  blocker: "bg-red-600", critical: "bg-orange-500",
  high: "bg-red-400",    normal: "bg-blue-500",    low: "bg-slate-400",
};

const TASK_PRIORITY_OPTIONS = [
  { value: "normal", label: "Normale" }, { value: "high", label: "Alta" },
  { value: "critical", label: "Critica" }, { value: "blocker", label: "Bloccante" },
  { value: "low", label: "Bassa" },
];

const AUDIT_LABELS: Record<string, string> = {
  created: "Ticket creato", status_changed: "Stato modificato",
  priority_changed: "Priorità modificata", assigned: "Assegnatario cambiato",
  message_added: "Messaggio aggiunto", field_changed: "Campo aggiornato",
};

const AVATAR_PALETTE = [
  "from-violet-500 to-violet-700", "from-blue-500 to-blue-700",
  "from-emerald-500 to-emerald-700", "from-rose-500 to-rose-700",
  "from-indigo-500 to-indigo-700", "from-cyan-500 to-cyan-700",
  "from-amber-500 to-amber-700",
];

type LinkedTask = Awaited<ReturnType<typeof getTasksByTicketId>>[number];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function avatarColor(name: string) {
  const h = [...name].reduce((a, c) => a + c.charCodeAt(0), 0);
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

function initials(name: string) {
  return name.split(/\s+/).map((w) => w[0]).join("").toUpperCase().slice(0, 2);
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
  if (diff < 86_400_000)
    return date.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  return date.toLocaleDateString("it-IT", {
    day: "numeric", month: "short",
    hour: "2-digit", minute: "2-digit",
  });
}

// ─── LinkedTasksCard ──────────────────────────────────────────────────────────

function LinkedTasksCard({ ticketId, currentUserId }: { ticketId: string; currentUserId?: string }) {
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
      await createTask({ title: data.title.trim(), priority: data.priority, dueDate: data.dueDate ? new Date(data.dueDate) : undefined, ticketId });
      reset(); setAdding(false); load();
    } catch { toast.error("Errore nella creazione dell'attività"); }
    finally { setSaving(false); }
  };

  return (
    <Card>
      <CardHeader className="pb-2 pt-3 px-3">
        <CardTitle className="flex items-center justify-between text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          <span className="flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Attività
            {tasks.length > 0 && (
              <span className="rounded-full bg-muted px-1.5 py-0.5 font-normal normal-case tracking-normal text-[10px]">
                {tasks.length}
              </span>
            )}
          </span>
          <button type="button" onClick={() => setAdding((v) => !v)}
            className="flex items-center gap-0.5 font-medium normal-case tracking-normal text-xs hover:text-foreground transition-colors">
            <Plus className="h-3.5 w-3.5" /> Nuova
          </button>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3 space-y-1">
        {adding && (
          <form onSubmit={handleSubmit(onSubmit)} className="mb-2 space-y-2 rounded-lg border bg-muted/30 p-2.5">
            <Input {...register("title")} placeholder="Titolo attività…" className="h-8 text-sm" autoFocus />
            <div className="flex gap-2">
              <select {...register("priority")}
                className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring">
                {TASK_PRIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <input type="date" {...register("dueDate")}
                className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
            <div className="flex justify-end gap-1.5">
              <button type="button" onClick={() => { setAdding(false); reset(); }}
                className="rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground">Annulla</button>
              <button type="submit" disabled={saving}
                className="rounded bg-primary px-3 py-1 font-semibold text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                {saving ? "…" : "Crea"}
              </button>
            </div>
          </form>
        )}
        {tasks.length === 0 && !adding && (
          <p className="py-1 text-muted-foreground text-sm italic">Nessuna attività</p>
        )}
        {tasks.map((task) => {
          const done = task.status === "done";
          return (
            <div key={task.id} className="group flex items-start gap-2 rounded-md p-1.5 transition-colors hover:bg-muted/50">
              {done
                ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                : <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
              <div className="min-w-0 flex-1">
                <p className={`truncate font-medium text-sm leading-snug ${done ? "text-muted-foreground line-through" : ""}`}>
                  {task.title}
                </p>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${PRIORITY_DOT[task.priority] ?? PRIORITY_DOT.normal}`} />
                  {task.dueDate && (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {new Date(task.dueDate).toLocaleDateString("it-IT", { day: "2-digit", month: "short" })}
                    </span>
                  )}
                  {task.assigneeName && <span className="truncate text-xs text-muted-foreground">{task.assigneeName}</span>}
                </div>
              </div>
              <TaskModal task={task} users={users} currentUserId={currentUserId}
                revalidatePathStr={`/dashboard/support/tickets/${ticketId}`}
                onUpdated={(updated) => setTasks((prev) => prev.map((t) => t.id === updated.id ? { ...t, ...updated } : t))} />
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
    <span className={`font-mono font-semibold text-sm tabular-nums ${isOverdue ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
      {isOverdue && <AlertTriangle className="mr-1 inline h-3 w-3" />}{remaining}
    </span>
  );
}

// ─── Timeline sub-components ──────────────────────────────────────────────────

function AuditEvent({ entry }: { entry: any }) {
  const actor = entry.actor?.name ?? entry.actorName ?? "Sistema";
  const label = AUDIT_LABELS[entry.action] ?? entry.action;
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="flex-1 h-px bg-border" />
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground whitespace-nowrap">
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
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

function AttachmentChips({ docs }: { docs: any[] }) {
  if (!docs.length) return null;
  return (
    <div className="mt-2.5 flex flex-wrap gap-1.5">
      {docs.map((doc) => {
        const isPdf = doc.mimeType === "application/pdf";
        return (
          <a key={doc.id} href={`/api/documents/${doc.id}${isPdf ? "?view=1" : ""}`}
            target={isPdf ? "_blank" : undefined} download={!isPdf ? doc.name : undefined}
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-md border bg-background/80 px-2 py-1 text-xs transition-colors hover:bg-muted">
            <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
            <span className="max-w-[140px] truncate font-medium">{doc.name}</span>
            {doc.size != null && <span className="text-muted-foreground">({formatBytes(doc.size)})</span>}
          </a>
        );
      })}
    </div>
  );
}

function MessageBubble({ msg, docs, isAgent }: { msg: any; docs?: any[]; isAgent: boolean }) {
  const senderName = msg.sender?.name ?? msg.senderName ?? msg.senderEmail?.split("@")[0] ?? "Sconosciuto";
  const isInternal = !msg.isPublic;
  const stamp = formatStamp(new Date(msg.createdAt));

  if (isInternal) {
    return (
      <div className="rounded-xl border border-amber-200/60 bg-amber-50/70 px-4 py-3 dark:border-amber-800/30 dark:bg-amber-950/20">
        <div className="mb-1.5 flex items-center gap-2">
          <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-white text-[10px] font-bold ${avatarColor(senderName)}`}>
            {initials(senderName)}
          </div>
          <span className="font-semibold text-sm text-amber-800 dark:text-amber-300">{senderName}</span>
          <Badge variant="secondary" className="h-4 gap-0.5 bg-amber-100 px-1.5 text-[10px] text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
            <Lock className="h-2.5 w-2.5" /> Nota interna
          </Badge>
          <span className="ml-auto text-xs text-amber-600/70 dark:text-amber-500/60">{stamp}</span>
        </div>
        {msg.content?.startsWith("<")
          ? <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed prose-p:text-amber-900 dark:prose-p:text-amber-100" dangerouslySetInnerHTML={{ __html: msg.content }} />
          : <p className="whitespace-pre-wrap text-sm leading-relaxed text-amber-900 dark:text-amber-100">{msg.content}</p>}
        <AttachmentChips docs={docs ?? []} />
      </div>
    );
  }

  if (isAgent) {
    return (
      <div className="flex gap-3 justify-end">
        <div className="max-w-[85%] min-w-0">
          <div className="mb-1 flex items-center justify-end gap-2">
            {msg.channel && <span className="text-muted-foreground/60">{CHANNEL_ICONS[msg.channel]}</span>}
            <span className="text-xs text-muted-foreground/70">{stamp}</span>
            <span className="font-semibold text-sm">{senderName}</span>
          </div>
          <div className="rounded-2xl rounded-tr-sm bg-primary/8 dark:bg-primary/12 border border-primary/12 px-4 py-3">
            {msg.content?.startsWith("<")
              ? <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: msg.content }} />
              : <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</p>}
            <AttachmentChips docs={docs ?? []} />
          </div>
        </div>
        <div className={`mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-white text-[10px] font-bold self-start ${avatarColor(senderName)}`}>
          {initials(senderName)}
        </div>
      </div>
    );
  }

  // Customer message
  return (
    <div className="flex gap-3">
      <div className={`mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-white text-[10px] font-bold self-start ${avatarColor(senderName)}`}>
        {initials(senderName)}
      </div>
      <div className="max-w-[85%] min-w-0">
        <div className="mb-1 flex items-center gap-2">
          <span className="font-semibold text-sm">{senderName}</span>
          {msg.senderEmail && <span className="text-xs text-muted-foreground/70">&lt;{msg.senderEmail}&gt;</span>}
          {msg.channel && <span className="text-muted-foreground/60">{CHANNEL_ICONS[msg.channel]}</span>}
          <span className="text-xs text-muted-foreground/70">{stamp}</span>
        </div>
        <div className="rounded-2xl rounded-tl-sm bg-muted/60 border border-border/60 px-4 py-3">
          {msg.content?.startsWith("<")
            ? <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: msg.content }} />
            : <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</p>}
          <AttachmentChips docs={docs ?? []} />
        </div>
      </div>
    </div>
  );
}

// ─── Sidebar cards ────────────────────────────────────────────────────────────

function ContactCard({ ticket }: { ticket: any }) {
  const contact = ticket.contact;
  if (!contact) {
    return (
      <Card>
        <CardContent className="px-3 py-3">
          <p className="text-muted-foreground text-xs italic">Nessun contatto collegato</p>
        </CardContent>
      </Card>
    );
  }
  const name = contact.name ?? (`${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() || "—");
  return (
    <Card>
      <CardHeader className="pb-2 pt-3 px-3">
        <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
          <User className="h-3.5 w-3.5" /> Cliente
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3 space-y-2.5">
        <div className="flex items-center gap-2.5">
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-white text-xs font-bold ${avatarColor(name)}`}>
            {initials(name)}
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-sm truncate">{name}</p>
            {contact.email && <p className="text-sm text-muted-foreground truncate">{contact.email}</p>}
          </div>
        </div>
        {contact.phone && (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Phone className="h-3.5 w-3.5 shrink-0" />{contact.phone}
          </div>
        )}
        {ticket.company && (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground border-t pt-2">
            <Building2 className="h-3.5 w-3.5 shrink-0" />
            <span className="font-medium text-foreground">{ticket.company.name}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PropertiesCard({
  ticket, onStatusChange, onPriorityChange, onReassign,
}: {
  ticket: any;
  onStatusChange: (s: string) => void;
  onPriorityChange: (p: string) => void;
  onReassign: () => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-2 pt-3 px-3">
        <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Proprietà
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3 space-y-3">
        {/* Status pills */}
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">Stato</p>
          <div className="flex flex-wrap gap-1">
            {STATUS_OPTIONS.map((opt) => (
              <button key={opt.value} type="button" onClick={() => onStatusChange(opt.value)}
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold transition-all ${
                  ticket.status === opt.value
                    ? `${opt.color} ring-1 ring-inset ring-current/30`
                    : "bg-muted/50 text-muted-foreground hover:bg-muted"
                }`}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Priority */}
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">Priorità</p>
          <div className="flex gap-1">
            {PRIORITY_OPTIONS.map((opt) => (
              <button key={opt.value} type="button" onClick={() => onPriorityChange(opt.value)}
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold transition-all ${
                  (ticket.priority ?? "normal") === opt.value
                    ? `bg-muted ${opt.color} ring-1 ring-inset ring-current/20`
                    : "bg-muted/50 text-muted-foreground hover:bg-muted"
                }`}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Assignee */}
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">Assegnato a</p>
          <button type="button" onClick={onReassign}
            className="group flex w-full items-center gap-2 rounded-lg border border-dashed border-border/60 px-2.5 py-1.5 transition-colors hover:border-primary/40 hover:bg-primary/5">
            <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted">
              <User className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <span className="truncate text-sm font-medium">{ticket.assignee?.name ?? "Non assegnato"}</span>
            <MoreHorizontal className="ml-auto h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        </div>

        {/* SLA tier + severity */}
        {(ticket.sla || ticket.severity) && (
          <div className="flex flex-wrap gap-1.5 border-t pt-2.5">
            {ticket.sla && <Badge variant="outline" className="text-xs">{ticket.sla.name}</Badge>}
            {ticket.severity && ticket.severity !== "normal" && (
              <Badge variant="outline" className="text-xs capitalize">Severity: {ticket.severity}</Badge>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SLACard({ ticket, slaFirstTarget, slaResTarget }: { ticket: any; slaFirstTarget: Date | null; slaResTarget: Date | null }) {
  if (!ticket.sla && !ticket.firstResponseAt && !ticket.resolvedAt) return null;
  return (
    <Card>
      <CardHeader className="pb-2 pt-3 px-3">
        <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5" /> SLA
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Prima risposta</span>
          {ticket.firstResponseAt
            ? <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">✓ {new Date(ticket.firstResponseAt).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}</span>
            : <SLATimer targetDate={slaFirstTarget} />}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Risoluzione</span>
          {ticket.resolvedAt
            ? <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">✓ {new Date(ticket.resolvedAt).toLocaleDateString("it-IT", { day: "numeric", month: "short" })}</span>
            : <SLATimer targetDate={slaResTarget} />}
        </div>
        {ticket.closedAt && (
          <div className="flex items-center justify-between border-t pt-2">
            <span className="text-sm text-muted-foreground">Chiuso</span>
            <span className="font-mono text-sm">{new Date(ticket.closedAt).toLocaleDateString("it-IT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AttachmentsCard({ docs }: { docs: any[] }) {
  return (
    <Card>
      <CardHeader className="pb-2 pt-3 px-3">
        <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
          <Paperclip className="h-3.5 w-3.5" />
          Allegati
          {docs.length > 0 && (
            <span className="rounded-full bg-muted px-1.5 py-0.5 font-normal normal-case tracking-normal text-[10px] text-muted-foreground">
              {docs.length}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3 space-y-1">
        {docs.length === 0
          ? <p className="py-0.5 text-sm text-muted-foreground italic">Nessun allegato</p>
          : docs.map((doc) => {
            const isPdf = doc.mimeType === "application/pdf";
            return (
              <a key={doc.id} href={`/api/documents/${doc.id}${isPdf ? "?view=1" : ""}`}
                target={isPdf ? "_blank" : undefined} download={!isPdf ? doc.name : undefined}
                rel="noopener noreferrer"
                className="group flex items-center gap-2 rounded-md p-1.5 transition-colors hover:bg-muted/50">
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium leading-snug group-hover:text-primary">{doc.name}</p>
                  {doc.size != null && <p className="text-xs text-muted-foreground">{formatBytes(doc.size)}</p>}
                </div>
                <ExternalLink className="h-3 w-3 text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity" />
              </a>
            );
          })}
      </CardContent>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = React.use(params);
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);

  const [ticket, setTicket] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [macros, setMacros] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [presence, setPresence] = useState<any[]>([]);
  const [ticketDocs, setTicketDocs] = useState<Record<string, any>>({});

  const [replyContent, setReplyContent] = useState("");
  const [isInternal, setIsInternal] = useState(false);
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
        fetch(`/api/documents?entityType=ticket&entityId=${id}`).then((r) => r.json()).catch(() => ({ documents: [] })),
      ]);
      if (data) {
        setTicket(data);
        setMessages([...(data.messages ?? [])].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()));
        setAuditLogs([...(data.auditLogs ?? [])].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()));
        setSelectedAssignee(encodeAssignee(data.assigneeId, null));
      }
      const docsById: Record<string, any> = {};
      for (const doc of docsRes.documents ?? []) docsById[doc.id] = doc;
      setTicketDocs(docsById);
    } catch (e) { console.error("Failed to load ticket:", e); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { loadTicket(); getMacros().then(setMacros).catch(console.error); }, [id, loadTicket]);
  useEffect(() => { if (!loading) scrollToBottom(); }, [loading, scrollToBottom]);
  useEffect(() => {
    const announce = (action: "viewing" | "typing") =>
      fetch(`/api/tickets/${id}/presence`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) }).catch(console.error);
    const poll = () => fetch(`/api/tickets/${id}/presence`).then((r) => r.json()).then((d: unknown[]) => setPresence(d)).catch(console.error);
    announce("viewing"); poll();
    const t = setInterval(() => { announce("viewing"); poll(); }, 15_000);
    return () => clearInterval(t);
  }, [id]);

  const isReplyEmpty = !replyContent.trim() || replyContent === "<p></p>";

  const handleSendReply = useCallback(async () => {
    if (isReplyEmpty) return;
    setSending(true);
    try {
      const result = await addTicketMessageAction(id, { content: replyContent, channel: ticket?.channel ?? "email", isPublic: !isInternal });
      if (result?.linkedFromClosed) {
        toast.info(`Ticket chiuso — nuovo ticket ${result.newTicketNumber} creato`);
        router.push(`/dashboard/support/tickets/${result.newTicketId}`);
        return;
      }
      setReplyContent("<p></p>");
      await loadTicket();
      scrollToBottom();
    } catch (err: any) { toast.error(err.message ?? "Invio fallito"); }
    finally { setSending(false); }
  }, [id, isInternal, isReplyEmpty, loadTicket, replyContent, router, scrollToBottom, ticket?.channel]);

  const handleStatusChange = useCallback(async (status: string) => {
    try {
      await updateTicketAction(id, { status: status as any });
      setTicket((p: any) => ({ ...p, status }));
      toast.success("Stato aggiornato");
    } catch (err: any) { toast.error(err.message ?? "Errore"); }
  }, [id]);

  const handlePriorityChange = useCallback(async (priority: string) => {
    try {
      await updateTicketAction(id, { priority: priority as any });
      setTicket((p: any) => ({ ...p, priority }));
      toast.success("Priorità aggiornata");
    } catch (err: any) { toast.error(err.message ?? "Errore"); }
  }, [id]);

  const handleEscalate = useCallback(async () => {
    try {
      const result = await escalateTicketAction(id);
      if (result.alreadyMaxPriority) { toast.info("Priorità già al massimo (Urgente)"); return; }
      setTicket((p: any) => ({ ...p, priority: result.newPriority }));
      toast.success(`Priorità escalata a ${result.newPriority}`);
    } catch (err: any) { toast.error(err.message ?? "Errore"); }
  }, [id]);

  const handleReassign = useCallback(async () => {
    setReassigning(true);
    try {
      const { ownerId } = decodeAssignee(selectedAssignee);
      await reassignTicketAction(id, ownerId);
      await loadTicket();
      setReassignOpen(false);
      toast.success(ownerId ? "Ticket riassegnato" : "Assegnatario rimosso");
    } catch (err: any) { toast.error(err.message ?? "Errore"); }
    finally { setReassigning(false); }
  }, [id, loadTicket, selectedAssignee]);

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    try {
      await deleteTicketAction(id);
      toast.success("Ticket eliminato");
      router.push("/dashboard/support/tickets");
    } catch (err: any) {
      toast.error(err.message ?? "Errore");
      setDeleting(false); setDeleteOpen(false);
    }
  }, [id, router]);

  const slaFirstTarget = ticket?.sla && !ticket.firstResponseAt
    ? new Date(new Date(ticket.createdAt).getTime() + ticket.sla.firstResponseTimeMinutes * 60_000) : null;
  const slaResTarget = ticket?.sla && !ticket.resolvedAt
    ? new Date(new Date(ticket.createdAt).getTime() + ticket.sla.resolutionTimeMinutes * 60_000) : null;

  // Build chronological timeline merging messages + audit events
  const timeline = [
    ...messages.map((m) => ({ type: "message" as const, ts: new Date(m.createdAt).getTime(), data: m })),
    ...auditLogs.map((a) => ({ type: "audit" as const, ts: new Date(a.createdAt).getTime(), data: a })),
  ].sort((a, b) => a.ts - b.ts);

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col gap-0 animate-pulse p-6">
        <div className="h-4 w-28 rounded bg-muted mb-6" />
        <div className="h-7 w-96 rounded bg-muted mb-3" />
        <div className="h-4 w-64 rounded bg-muted mb-6" />
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-3">
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
        <p className="mb-4 text-muted-foreground">Ticket non trovato</p>
        <Button asChild variant="outline"><Link href="/dashboard/support/tickets">← Torna ai ticket</Link></Button>
      </div>
    );
  }

  const typingUsers = presence.filter((p) => p.action === "typing");

  return (
    <>
      {/* Cancel parent vertical padding only, fill viewport below the 3rem app header */}
      <div className="-my-4 md:-my-6 flex flex-col overflow-hidden" style={{ height: "calc(100vh - 3rem)" }}>

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="shrink-0 border-b bg-background px-6 pb-4 pt-5">
          {/* Breadcrumb + actions */}
          <div className="mb-3 flex items-center justify-between gap-4">
            <Link href="/dashboard/support/tickets"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
              <ArrowLeft className="h-3.5 w-3.5" /> Tutti i ticket
            </Link>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-semibold text-muted-foreground">{ticket.ticketNumber}</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 gap-1">
                    Azioni <ChevronDown className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem onClick={handleEscalate} className="gap-2">
                    <TrendingUp className="h-4 w-4 text-orange-500" /> Escala priorità
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setReassignOpen(true)} className="gap-2">
                    <UserCheck className="h-4 w-4 text-blue-500" /> Riassegna
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setDeleteOpen(true)} className="gap-2 text-destructive focus:text-destructive">
                    <Trash2 className="h-4 w-4" /> Elimina ticket
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Title */}
          <h1 className="font-bold text-2xl leading-tight tracking-tight mb-2">{ticket.subject}</h1>

          {/* Meta row */}
          <div className="flex flex-wrap items-center gap-2">
            <TicketStatusBadge status={ticket.status} />
            <TicketPriorityBadge priority={ticket.priority} />
            <Badge variant="outline" className="h-5 gap-1 text-xs">
              {CHANNEL_ICONS[ticket.channel]}
              <span className="capitalize">{ticket.channel}</span>
            </Badge>
            {ticket.severity && ticket.severity !== "normal" && (
              <Badge variant="outline" className="h-5 text-xs capitalize">Severity: {ticket.severity}</Badge>
            )}
            {ticket.tags?.map((tag: string) => (
              <Badge key={tag} variant="secondary" className="h-5 text-xs">{tag}</Badge>
            ))}
            <span className="flex items-center gap-1 text-xs text-muted-foreground ml-1">
              <Clock className="h-3.5 w-3.5" />
              {new Date(ticket.createdAt).toLocaleString("it-IT", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
        </div>

        {/* ── Body grid ───────────────────────────────────────────────────── */}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[1fr_300px]">

          {/* ── Left: Conversation ──────────────────────────────────────── */}
          <div className="flex flex-col min-h-0 border-r">

            {/* Typing presence banner */}
            {typingUsers.length > 0 && (
              <div className="flex items-center gap-2 border-b bg-amber-50/80 px-6 py-2 text-xs text-amber-700 dark:border-amber-800/30 dark:bg-amber-950/20 dark:text-amber-400">
                <span className="flex gap-0.5">
                  {[0, 150, 300].map((d) => (
                    <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-amber-500" style={{ animationDelay: `${d}ms` }} />
                  ))}
                </span>
                {typingUsers.map((p: any) => p.userName).join(", ")} sta scrivendo…
              </div>
            )}

            {/* Timeline */}
            <div ref={scrollRef}
              className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-4">
              {timeline.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <MessageSquare className="mb-3 h-10 w-10 text-muted-foreground/20" />
                  <p className="text-sm text-muted-foreground">Nessun messaggio ancora.</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">Invia la prima risposta qui sotto.</p>
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
            <div className={`shrink-0 border-t p-4 space-y-3 ${isInternal ? "bg-amber-50/40 dark:bg-amber-950/10" : "bg-background"}`}>

              {/* Public / Internal toggle */}
              <div className="flex items-center gap-1 w-fit rounded-lg border bg-muted/40 p-0.5">
                {[
                  { val: false, icon: Send, label: "Risposta pubblica" },
                  { val: true, icon: Lock, label: "Nota interna" },
                ].map(({ val, icon: Icon, label }) => (
                  <button key={String(val)} type="button" onClick={() => setIsInternal(val)}
                    className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium transition-all ${
                      isInternal === val
                        ? val ? "bg-amber-100 text-amber-700 shadow-sm dark:bg-amber-900/40 dark:text-amber-300"
                               : "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}>
                    <Icon className="h-3 w-3" />{label}
                  </button>
                ))}
              </div>

              {/* Editor */}
              <div onKeyDown={(e) => { if (e.ctrlKey && e.key === "Enter") { e.preventDefault(); handleSendReply(); } }}>
                <RichTextEditor value={replyContent}
                  onChange={(html) => {
                    setReplyContent(html);
                    fetch(`/api/tickets/${id}/presence`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "typing" }) }).catch(() => {});
                  }}
                  placeholder={isInternal ? "Scrivi una nota interna (visibile solo al team)…" : "Scrivi una risposta al cliente…"}
                  className={isInternal ? "border-amber-300 dark:border-amber-700" : ""}
                  macroVariables />
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between">
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  {isInternal
                    ? <><Shield className="h-3 w-3" /> Visibile solo agli agenti</>
                    : <>Ctrl+Enter per inviare</>}
                </p>
                <div className="flex items-center gap-2">
                  {macros.length > 0 && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="h-8 gap-1.5">
                          <Zap className="h-3.5 w-3.5" /> Macro
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="max-h-60 w-52 overflow-y-auto">
                        {macros.map((macro: any) => (
                          <DropdownMenuItem key={macro.id} className="flex flex-col items-start gap-0.5 py-2"
                            onClick={() => {
                              setReplyContent(macro.body
                                .replace(/\{ticket\.number\}/g, ticket?.ticketNumber ?? "")
                                .replace(/\{contact\.firstName\}/g, ticket?.contact?.firstName ?? ticket?.contact?.name?.split(" ")[0] ?? "")
                                .replace(/\{agent\.name\}/g, ""));
                              setIsInternal(!macro.isPublic);
                            }}>
                            <span className="font-medium text-sm">{macro.name}</span>
                            {macro.description && <span className="w-full truncate text-xs text-muted-foreground">{macro.description}</span>}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                  <Button variant="ghost" size="sm" className="h-8" onClick={() => setReplyContent("<p></p>")} disabled={isReplyEmpty}>
                    Pulisci
                  </Button>
                  <Button size="sm" className="h-8 gap-1.5" onClick={handleSendReply} disabled={isReplyEmpty || sending}>
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
            <PropertiesCard ticket={ticket} onStatusChange={handleStatusChange} onPriorityChange={handlePriorityChange} onReassign={() => setReassignOpen(true)} />
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
              <UserCheck className="h-5 w-5 text-blue-500" /> Riassegna ticket
            </DialogTitle>
            <DialogDescription>Seleziona un agente per gestire questo ticket.</DialogDescription>
          </DialogHeader>
          <AssigneeSelect value={selectedAssignee} onChange={setSelectedAssignee} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReassignOpen(false)}>Annulla</Button>
            <Button onClick={handleReassign} disabled={reassigning}>
              {reassigning ? "Riassegno…" : "Riassegna"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete dialog ───────────────────────────────────────────────── */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" /> Elimina ticket
            </DialogTitle>
            <DialogDescription>
              Sei sicuro di voler eliminare <span className="font-semibold text-foreground">{ticket.ticketNumber}</span>?
              Questa azione rimuoverà permanentemente il ticket e tutti i suoi messaggi.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleting}>Annulla</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? "Eliminazione…" : "Elimina"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
