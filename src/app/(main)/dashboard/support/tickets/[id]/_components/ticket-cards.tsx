"use client";

import { useEffect, useState } from "react";

import Link from "next/link";

import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock,
  ExternalLink,
  FileText,
  Mail,
  Paperclip,
  Pause,
  Phone,
  Plus,
  User,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { getCustomerTicketHistory, getOrdersForTicket, linkTicketToOrderAction } from "@/actions/support";
import { createTask } from "@/actions/tasks";
import { EmailAddressButton } from "@/components/crm/email-address-button";
import { EmptyHint, Field, FieldList, RelatedRow, StatusBadge } from "@/components/crm/record/record-page";
import { TaskModal } from "@/components/crm/task-modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCurrency } from "@/hooks/use-currency";
import { documentValues } from "@/lib/email-placeholders";
import { canTransition } from "@/lib/ticket-state-machine";
import { cn } from "@/lib/utils";

import {
  avatarColor,
  CHANNEL_ICONS,
  formatBytes,
  initials,
  type LinkedTask,
  labelOf,
  PRIORITY_VALUES,
  STATUS_TONE,
  STATUS_VALUES,
  slaDeadlines,
  type TicketDocument,
  type TicketPriority,
  type TicketRow,
  type TicketStatus,
} from "./ticket-shared";
import { MessageBody } from "./ticket-thread";

/**
 * The reference column: what the ticket is, who asked, what was promised, and
 * what it is connected to. Every card here is read beside the conversation, never
 * instead of it.
 */

const STAMP = { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" } as const;

// ─── Properties ───────────────────────────────────────────────────────────────

/**
 * Status, priority and assignee, editable where they always were; the rest of what
 * describes the ticket read-only beneath them.
 *
 * ⚠️ The status list offers only the moves the state machine allows. It used to
 * offer all seven as pills, and choosing a forbidden one reached the server and
 * came back as "Invalid transition: resolved → waiting" — in English, as a toast,
 * after the agent had already decided. A disabled option says the same thing
 * before anybody chooses it.
 */
export function PropertiesCard({
  ticket,
  canWrite,
  onStatusChange,
  onPriorityChange,
  onReassign,
}: {
  ticket: TicketRow;
  canWrite: boolean;
  onStatusChange: (s: TicketStatus) => void;
  onPriorityChange: (p: TicketPriority) => void;
  onReassign: () => void;
}) {
  const t = useTranslations("support.tickets");
  const format = useFormatter();
  const statusLabel = labelOf(t, "statuses", ticket.status);
  const priority = ticket.priority ?? "normal";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("properties")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <FieldList>
          <Field label={t("statusLabel")} always>
            {canWrite ? (
              <Select
                value={ticket.status}
                onValueChange={(v) => onStatusChange(v as TicketStatus)}
                disabled={ticket.status === "closed"}
              >
                <SelectTrigger size="sm" className="w-full" aria-label={t("statusLabel")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_VALUES.map((s) => (
                    <SelectItem key={s} value={s} disabled={s !== ticket.status && !canTransition(ticket.status, s)}>
                      {t(`statuses.${s}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <StatusBadge tone={STATUS_TONE[ticket.status] ?? "neutral"}>{statusLabel}</StatusBadge>
            )}
          </Field>
          <Field label={t("priorityLabel")} always>
            {canWrite ? (
              <Select value={priority} onValueChange={(v) => onPriorityChange(v as TicketPriority)}>
                <SelectTrigger size="sm" className="w-full" aria-label={t("priorityLabel")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITY_VALUES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {t(`priorities.${p}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              labelOf(t, "priorities", priority)
            )}
          </Field>
          <Field label={t("assignedTo")} always>
            {canWrite ? (
              <button
                type="button"
                onClick={onReassign}
                className="flex min-h-8 w-full min-w-0 items-center gap-2 rounded-md border border-dashed px-2.5 py-1 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
              >
                <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate font-medium">{ticket.assignee?.name ?? t("detail.unassigned")}</span>
              </button>
            ) : (
              (ticket.assignee?.name ?? t("detail.unassigned"))
            )}
          </Field>
          <Field label={t("channel")}>
            <span className="flex items-center gap-1.5">
              {CHANNEL_ICONS[ticket.channel]}
              {labelOf(t, "channels", ticket.channel)}
            </span>
          </Field>
          <Field label={t("detail.fields.type")}>{ticket.type ? labelOf(t, "detail.types", ticket.type) : null}</Field>
          <Field label={t("detail.fields.component")}>{ticket.component}</Field>
          <Field label={t("detail.fields.team")}>{ticket.group?.name}</Field>
          <Field label={t("createModal.severityLabel")}>
            {ticket.severity ? labelOf(t, "detail.severities", ticket.severity) : null}
          </Field>
          <Field label={t("createModal.tagsLabel")}>
            {ticket.tags && ticket.tags.length > 0 ? (
              <span className="flex flex-wrap gap-1">
                {ticket.tags.map((tag: string) => (
                  <Badge key={tag} variant="secondary" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </span>
            ) : null}
          </Field>
          <Field label={t("columns.created")}>{format.dateTime(new Date(ticket.createdAt), STAMP)}</Field>
          <Field label={t("columns.updated")}>{format.dateTime(new Date(ticket.updatedAt), STAMP)}</Field>
        </FieldList>

        {/* What the ticket was opened with. Folded, because for a ticket that
            arrived by email it repeats the first message of the thread; for one
            typed into the dashboard it is the only place the request is written. */}
        {ticket.description && (
          <details className="group/desc border-t pt-3">
            <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 font-medium text-muted-foreground text-xs hover:text-foreground [&::-webkit-details-marker]:hidden">
              {t("createModal.descriptionLabel")}
              <ChevronDown className="size-4 transition-transform group-open/desc:rotate-180" aria-hidden />
            </summary>
            <div className="mt-1 overflow-x-auto break-words [&_img]:h-auto [&_img]:max-w-full">
              <MessageBody content={ticket.description} />
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

// ─── SLA ──────────────────────────────────────────────────────────────────────

/** The two promises and when they were kept. The countdown itself is in the hero's figures. */
export function SlaCard({ ticket }: { ticket: TicketRow }) {
  const t = useTranslations("support.tickets");
  const format = useFormatter();
  const { firstDue, resolutionDue } = slaDeadlines(ticket);
  if (!ticket.sla && !firstDue && !resolutionDue && !ticket.firstResponseAt && !ticket.resolvedAt) return null;

  const kept = (at: Date | string) => (
    <span className="flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-400">
      <CheckCircle2 className="size-3.5 shrink-0" aria-hidden />
      {format.dateTime(new Date(at), STAMP)}
    </span>
  );
  const due = (at: Date | null, missed: boolean) =>
    at && (
      <span className={cn("flex items-center gap-1.5", missed && "font-medium text-destructive")}>
        {missed ? (
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
        ) : (
          <Clock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        )}
        {t("detail.sla.dueAt", { date: format.dateTime(at, STAMP) })}
      </span>
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("detail.sla.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <FieldList>
          <Field label={t("detail.sla.policy")}>{ticket.sla?.name}</Field>
          <Field label={t("firstResponse")} always>
            {ticket.firstResponseAt ? kept(ticket.firstResponseAt) : due(firstDue, !!ticket.firstResponseBreachedAt)}
          </Field>
          <Field label={t("resolution")} always>
            {ticket.resolvedAt ? kept(ticket.resolvedAt) : due(resolutionDue, !!ticket.slaBreachedAt)}
          </Field>
          <Field label={t("detail.sla.pausedSince")}>
            {ticket.slaPausedAt && (
              <span className="flex items-center gap-1.5">
                <Pause className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                {format.dateTime(new Date(ticket.slaPausedAt), STAMP)}
              </span>
            )}
          </Field>
          <Field label={t("detail.sla.breachedAt")}>
            {ticket.slaBreachedAt && (
              <span className="font-medium text-destructive">
                {format.dateTime(new Date(ticket.slaBreachedAt), STAMP)}
              </span>
            )}
          </Field>
          <Field label={t("closedLabel")}>{ticket.closedAt && format.dateTime(new Date(ticket.closedAt), STAMP)}</Field>
        </FieldList>
      </CardContent>
    </Card>
  );
}

// ─── Requester ────────────────────────────────────────────────────────────────

export function RequesterCard({ ticket, canWrite }: { ticket: TicketRow; canWrite: boolean }) {
  const t = useTranslations("support.tickets");
  const contact = ticket.contact;
  const name = contact ? `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() || "—" : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("requester")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {contact && name ? (
          <div className="flex items-center gap-3">
            <div
              className={`flex size-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br font-bold text-white text-xs ${avatarColor(name)}`}
              aria-hidden
            >
              {initials(name)}
            </div>
            <div className="min-w-0 space-y-0.5">
              <Link
                href={`/dashboard/contacts/${contact.id}`}
                className="block truncate font-semibold text-primary text-sm hover:underline"
              >
                {name}
              </Link>
              {contact.email && (
                <EmailAddressButton
                  email={contact.email}
                  entity={contact}
                  entityType="contact"
                  // "[argomento]" in a support template is the request's own subject.
                  fields={documentValues({ ticketNumber: ticket.ticketNumber, ticketSubject: ticket.subject })}
                  canSend={canWrite}
                  className="flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs hover:text-foreground"
                >
                  <Mail className="size-3 shrink-0" aria-hidden />
                  <span className="truncate">{contact.email}</span>
                </EmailAddressButton>
              )}
              {contact.phone && (
                <a
                  href={`tel:${contact.phone}`}
                  className="flex items-center gap-1.5 text-muted-foreground text-xs hover:text-foreground"
                >
                  <Phone className="size-3 shrink-0" aria-hidden />
                  {contact.phone}
                </a>
              )}
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">{t("noContactLinked")}</p>
        )}
        {ticket.company && (
          <Link
            href={`/dashboard/companies/${ticket.company.id}`}
            className="flex min-h-10 min-w-0 items-center gap-2 border-t pt-3 text-sm hover:text-primary"
          >
            <Building2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate font-medium">{ticket.company.name}</span>
          </Link>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Whether this customer has been here before.
 *
 * A first ticket and a fourth in a month are different conversations, and
 * answering the second as though it were the first is how somebody decides
 * nobody is listening. The sidebar said who they are and never whether they had
 * written before.
 */
export function CustomerHistoryCard({ ticket }: { ticket: TicketRow }) {
  const t = useTranslations("support.tickets");
  const [history, setHistory] = useState<Awaited<ReturnType<typeof getCustomerTicketHistory>> | null>(null);

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
      <CardHeader>
        <CardTitle className="text-base">{t("customerHistory")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-muted-foreground text-xs">
          {history.open > 0
            ? t("historySummaryOpen", { total: history.total, open: history.open })
            : t("historySummary", { total: history.total })}
        </p>
        <ul className="space-y-2">
          {history.recent.map((h) => (
            <li key={h.id}>
              <RelatedRow
                href={`/dashboard/support/tickets/${h.id}`}
                title={h.subject}
                aside={
                  <StatusBadge tone={STATUS_TONE[h.status] ?? "neutral"} className="text-[11px]">
                    {t.has(`statuses.${h.status}`) ? t(`statuses.${h.status}`) : h.status.replace(/_/g, " ")}
                  </StatusBadge>
                }
              />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

// ─── Order ────────────────────────────────────────────────────────────────────

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
export function OrderCard({
  ticket,
  canWrite,
  onLinked,
}: {
  ticket: TicketRow;
  canWrite: boolean;
  onLinked: () => void;
}) {
  const t = useTranslations("support.tickets");
  const tOrderStatus = useTranslations("orders.statuses");
  const { formatMoney } = useCurrency();
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
  // A viewer cannot link one, so a card with nothing linked has nothing to show them.
  if (!canWrite && !ticket.order) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("aboutOrder")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {ticket.order && (
          <RelatedRow
            href={`/dashboard/sales/orders/${ticket.order.id}`}
            title={ticket.order.orderNumber}
            aside={
              <span className="font-semibold tabular-nums">
                {formatMoney(ticket.order.totalAmount, ticket.order.currency)}
              </span>
            }
          />
        )}

        {canWrite && (
          <Select
            value={ticket.orderId ?? "__none__"}
            onValueChange={choose}
            disabled={saving}
            onOpenChange={(open) => open && load()}
          >
            <SelectTrigger size="sm" className="w-full" aria-label={t("aboutOrder")}>
              <SelectValue placeholder={t("chooseOrder")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">{t("noOrder")}</SelectItem>
              {orders.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.orderNumber} · {tOrderStatus.has(o.status) ? tOrderStatus(o.status) : o.status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {loading && <p className="text-[11px] text-muted-foreground">{t("loadingOrders")}</p>}
        {!loading && orders.length === 0 && ticket.orderId === null && canWrite && (
          <p className="text-[11px] text-muted-foreground">{t("noOrdersForCustomer")}</p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Tasks ────────────────────────────────────────────────────────────────────

// Values only: the words come from the message files, like every other list here.
const TASK_PRIORITY_OPTIONS = ["normal", "high", "critical", "blocker", "low"] as const;

const PRIORITY_DOT: Record<string, string> = {
  blocker: "bg-red-600",
  critical: "bg-orange-500",
  high: "bg-red-400",
  normal: "bg-blue-500",
  low: "bg-slate-400",
};

/** Five at a time; a ticket with thirty tasks is the exception, not the layout. */
const TASKS_SHOWN = 5;

/**
 * Follow-up work that belongs to this ticket. The list is held by the parent so
 * the phone's Tasks tab can say how many are open before it is opened.
 */
export function TasksCard({
  ticketId,
  tasks,
  users,
  canWrite,
  currentUserId,
  onCreated,
  onUpdated,
}: {
  ticketId: string;
  tasks: LinkedTask[];
  users: { id: string; name: string | null }[];
  canWrite: boolean;
  currentUserId?: string;
  onCreated: () => void;
  onUpdated: (updated: Partial<LinkedTask> & { id: string }) => void;
}) {
  const t = useTranslations("support.tickets");
  const tR = useTranslations("record");
  const format = useFormatter();
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const { register, handleSubmit, reset } = useForm<{ title: string; priority: string; dueDate: string }>({
    defaultValues: { priority: "normal", dueDate: "", title: "" },
  });

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
      onCreated();
    } catch {
      toast.error(t("taskCreateFailed"));
    } finally {
      setSaving(false);
    }
  };

  // Open work first; what is done sinks to the bottom.
  const ordered = [...tasks.filter((tk) => tk.status !== "done"), ...tasks.filter((tk) => tk.status === "done")];
  const shown = expanded ? ordered : ordered.slice(0, TASKS_SHOWN);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          {t("detail.tasks")}
          {tasks.length > 0 && (
            <span className="font-normal text-muted-foreground text-xs tabular-nums">{tasks.length}</span>
          )}
        </CardTitle>
        {canWrite && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setAdding((v) => !v)} aria-expanded={adding}>
            <Plus className="size-3.5" aria-hidden /> {t("newLabel")}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {adding && (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-2 rounded-lg border bg-muted/30 p-2.5">
            <Input
              {...register("title")}
              placeholder={t("detail.taskTitlePlaceholder")}
              aria-label={t("taskTitle")}
              className="h-9"
              autoFocus
            />
            {/* One per row on a phone: a date input will not shrink below the
                picker the browser draws over it. */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <select
                {...register("priority")}
                aria-label={t("priorityLabel")}
                className="h-9 min-w-0 rounded-md border border-input bg-background px-2 text-base focus:outline-none focus:ring-1 focus:ring-ring sm:text-sm"
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
                aria-label={t("detail.fields.dueDate")}
                className="h-9 min-w-0 rounded-md border border-input bg-background px-2 text-base focus:outline-none focus:ring-1 focus:ring-ring sm:text-sm"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setAdding(false);
                  reset();
                }}
              >
                {t("cancel")}
              </Button>
              <Button type="submit" size="sm" disabled={saving}>
                {saving ? "…" : t("detail.create")}
              </Button>
            </div>
          </form>
        )}
        {tasks.length === 0 && !adding && <EmptyHint>{t("noTasks")}</EmptyHint>}
        {shown.length > 0 && (
          <ul className="divide-y">
            {shown.map((task) => {
              const done = task.status === "done";
              return (
                <li key={task.id} className="flex items-center gap-2 py-1.5">
                  {done ? (
                    <CheckCircle2 className="size-4 shrink-0 text-emerald-500" aria-hidden />
                  ) : (
                    <Circle className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className={cn("break-words text-sm", done && "text-muted-foreground line-through")}>
                      {task.title}
                    </p>
                    <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${PRIORITY_DOT[task.priority] ?? PRIORITY_DOT.normal}`}
                        aria-hidden
                      />
                      {task.dueDate && (
                        <span className="text-muted-foreground text-xs tabular-nums">
                          {format.dateTime(new Date(task.dueDate), { day: "2-digit", month: "short" })}
                        </span>
                      )}
                      {task.assigneeName && (
                        <span className="truncate text-muted-foreground text-xs">{task.assigneeName}</span>
                      )}
                    </div>
                  </div>
                  {canWrite && (
                    <TaskModal
                      task={task}
                      users={users}
                      currentUserId={currentUserId}
                      revalidatePathStr={`/dashboard/support/tickets/${ticketId}`}
                      onUpdated={onUpdated}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {ordered.length > TASKS_SHOWN && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full text-muted-foreground"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? tR("showLess") : tR("showMore")}
            <ChevronDown className={cn("size-4 transition-transform", expanded && "rotate-180")} aria-hidden />
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Attachments ──────────────────────────────────────────────────────────────

export function AttachmentsCard({ docs }: { docs: TicketDocument[] }) {
  const t = useTranslations("support.tickets");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {t("detail.attachments")}
          {docs.length > 0 && (
            <span className="font-normal text-muted-foreground text-xs tabular-nums">{docs.length}</span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {docs.length === 0 ? (
          <p className="flex items-center gap-2 text-muted-foreground text-sm">
            <Paperclip className="size-3.5" aria-hidden />
            {t("noAttachments")}
          </p>
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
                className="group flex min-h-11 items-center gap-2 rounded-md p-1.5 transition-colors hover:bg-muted/50"
              >
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-sm leading-snug group-hover:text-primary">{doc.name}</p>
                  {doc.size != null && <p className="text-muted-foreground text-xs">{formatBytes(doc.size)}</p>}
                </div>
                <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground/60" aria-hidden />
              </a>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
