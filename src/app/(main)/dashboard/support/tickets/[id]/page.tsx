"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ChevronDown,
  Clock,
  Lock,
  Mail,
  MessageCircle,
  MessageSquare,
  MoreHorizontal,
  Phone,
  Send,
  Shield,
  Trash2,
  TrendingUp,
  User,
  UserCheck,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { TicketStatusBadge } from "@/components/crm/ticket-status-badge";
import { TicketPriorityBadge } from "@/components/crm/ticket-priority-badge";
import {
  getTicketById,
  addTicketMessageAction,
  updateTicketAction,
  deleteTicketAction,
  reassignTicketAction,
  escalateTicketAction,
  getAgents,
} from "@/actions/support";

const CHANNEL_ICONS: Record<string, React.ReactNode> = {
  email:  <Mail className="h-3.5 w-3.5" />,
  chat:   <MessageCircle className="h-3.5 w-3.5" />,
  phone:  <Phone className="h-3.5 w-3.5" />,
  social: <Users className="h-3.5 w-3.5" />,
};

const PRIORITY_OPTIONS = [
  { value: "urgent", label: "Urgent" },
  { value: "high",   label: "High" },
  { value: "normal", label: "Normal" },
  { value: "low",    label: "Low" },
];

const STATUS_OPTIONS = [
  { value: "open",        label: "Open" },
  { value: "in_progress", label: "In Progress" },
  { value: "waiting",     label: "Waiting" },
  { value: "resolved",    label: "Resolved" },
  { value: "closed",      label: "Closed" },
];

function SLATimer({ targetDate }: { targetDate: Date | null }) {
  const [remaining, setRemaining] = useState<string | null>(null);
  const [isOverdue, setIsOverdue] = useState(false);

  useEffect(() => {
    if (!targetDate) return;

    const update = () => {
      const diff = new Date(targetDate).getTime() - Date.now();
      if (diff <= 0) {
        setIsOverdue(true);
        const overdueMs = Math.abs(diff);
        const h = Math.floor(overdueMs / 3_600_000);
        const m = Math.floor((overdueMs % 3_600_000) / 60_000);
        setRemaining(`${h}h ${m}m overdue`);
      } else {
        setIsOverdue(false);
        const h = Math.floor(diff / 3_600_000);
        const m = Math.floor((diff % 3_600_000) / 60_000);
        setRemaining(`${h}h ${m}m`);
      }
    };

    update();
    const interval = setInterval(update, 60_000);
    return () => clearInterval(interval);
  }, [targetDate]);

  if (!targetDate || !remaining) return <span className="text-muted-foreground">—</span>;

  return (
    <span className={`font-mono text-xs font-semibold ${isOverdue ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>
      {remaining}
    </span>
  );
}

function MessageBubble({ msg }: { msg: any }) {
  const senderName =
    msg.sender?.name ?? msg.senderName ?? msg.senderEmail?.split("@")[0] ?? "Unknown";
  const initials = senderName
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const date = new Date(msg.createdAt);
  const timeStr = date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const isInternal = !msg.isPublic;

  return (
    <div
      className={`flex gap-3 group ${
        isInternal
          ? "bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-800/30 rounded-lg p-3"
          : ""
      }`}
    >
      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0 mt-0.5">
        {initials}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="font-semibold text-sm">{senderName}</span>
          {isInternal && (
            <Badge variant="secondary" className="text-[10px] h-4 gap-1 px-1.5 bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
              <Lock className="h-2.5 w-2.5" />
              Internal note
            </Badge>
          )}
          {msg.channel && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              {CHANNEL_ICONS[msg.channel]}
            </span>
          )}
          <span className="text-xs text-muted-foreground">{timeStr}</span>
        </div>
        <p className="text-sm text-foreground whitespace-pre-wrap break-words leading-relaxed">
          {msg.content}
        </p>
      </div>
    </div>
  );
}

export default function TicketDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [ticket, setTicket] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [agents, setAgents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Reply form
  const [replyContent, setReplyContent] = useState("");
  const [isInternal, setIsInternal] = useState(false);
  const [sending, setSending] = useState(false);

  // Dialogs
  const [reassignOpen, setReassignOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selectedAssignee, setSelectedAssignee] = useState<string>("unassigned");
  const [reassigning, setReassigning] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadTicket = async () => {
    try {
      const data = await getTicketById(params.id);
      if (data) {
        setTicket(data);
        const sorted = [...(data.messages ?? [])].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
        setMessages(sorted);
        setSelectedAssignee(data.assigneeId ?? "unassigned");
      }
    } catch (error) {
      console.error("Failed to load ticket:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTicket();
    getAgents().then(setAgents).catch(() => {});
  }, [params.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSendReply = async () => {
    if (!replyContent.trim()) return;
    setSending(true);
    try {
      await addTicketMessageAction(params.id, {
        content: replyContent,
        channel: ticket?.channel ?? "email",
        isPublic: !isInternal,
      });
      setReplyContent("");
      await loadTicket();
    } catch (err: any) {
      toast.error(err.message ?? "Failed to send reply");
    } finally {
      setSending(false);
    }
  };

  const handleStatusChange = async (status: string) => {
    try {
      await updateTicketAction(params.id, { status: status as "open" | "in_progress" | "waiting" | "resolved" | "closed" });
      setTicket((prev: any) => ({ ...prev, status }));
      toast.success("Status updated");
    } catch (err: any) {
      toast.error(err.message ?? "Failed to update status");
    }
  };

  const handlePriorityChange = async (priority: string) => {
    try {
      await updateTicketAction(params.id, { priority: priority as "low" | "normal" | "high" | "urgent" });
      setTicket((prev: any) => ({ ...prev, priority }));
      toast.success("Priority updated");
    } catch (err: any) {
      toast.error(err.message ?? "Failed to update priority");
    }
  };

  const handleEscalate = async () => {
    try {
      const result = await escalateTicketAction(params.id);
      if (result.alreadyMaxPriority) {
        toast.info("Ticket is already at maximum priority (Urgent)");
        return;
      }
      setTicket((prev: any) => ({ ...prev, priority: result.newPriority }));
      toast.success(`Priority escalated to ${result.newPriority}`);
    } catch (err: any) {
      toast.error(err.message ?? "Failed to escalate ticket");
    }
  };

  const handleReassign = async () => {
    setReassigning(true);
    try {
      const newAssigneeId = selectedAssignee === "unassigned" ? null : selectedAssignee;
      await reassignTicketAction(params.id, newAssigneeId);
      const newAgent = agents.find((a) => a.id === newAssigneeId);
      setTicket((prev: any) => ({ ...prev, assigneeId: newAssigneeId, assignee: newAgent ?? null }));
      setReassignOpen(false);
      toast.success(newAgent ? `Reassigned to ${newAgent.name}` : "Assignee removed");
    } catch (err: any) {
      toast.error(err.message ?? "Failed to reassign ticket");
    } finally {
      setReassigning(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteTicketAction(params.id);
      toast.success("Ticket deleted");
      router.push("/dashboard/support/tickets");
    } catch (err: any) {
      toast.error(err.message ?? "Failed to delete ticket");
      setDeleting(false);
      setDeleteOpen(false);
    }
  };

  // SLA targets
  const slaFirstResponseTarget = ticket?.sla && !ticket.firstResponseAt
    ? new Date(new Date(ticket.createdAt).getTime() + ticket.sla.firstResponseTimeMinutes * 60_000)
    : null;
  const slaResolutionTarget = ticket?.sla && !ticket.resolvedAt
    ? new Date(new Date(ticket.createdAt).getTime() + ticket.sla.resolutionTimeMinutes * 60_000)
    : null;

  // Loading skeleton
  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-5 w-32 bg-muted rounded" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <div className="h-28 bg-muted rounded-xl" />
            <div className="h-96 bg-muted rounded-xl" />
          </div>
          <div className="space-y-4">
            <div className="h-52 bg-muted rounded-xl" />
            <div className="h-40 bg-muted rounded-xl" />
            <div className="h-32 bg-muted rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="text-center py-20">
        <MessageSquare className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
        <p className="text-muted-foreground mb-4">Ticket not found</p>
        <Button asChild>
          <Link href="/dashboard/support/tickets">Back to Tickets</Link>
        </Button>
      </div>
    );
  }

  const createdAt = new Date(ticket.createdAt).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <>
      <div className="space-y-5">
        {/* Back nav */}
        <Link
          href="/dashboard/support/tickets"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          All Tickets
        </Link>

        {/* Page header */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <span className="font-mono text-xs font-semibold text-muted-foreground">
              {ticket.ticketNumber}
            </span>
            <h1 className="text-2xl font-bold tracking-tight mt-1 leading-tight">
              {ticket.subject}
            </h1>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <TicketStatusBadge status={ticket.status} />
              <TicketPriorityBadge priority={ticket.priority} />
              <Badge variant="outline" className="flex items-center gap-1 text-xs">
                {CHANNEL_ICONS[ticket.channel]}
                <span className="capitalize">{ticket.channel}</span>
              </Badge>
              {ticket.severity && ticket.severity !== "normal" && (
                <Badge variant="outline" className="text-xs capitalize">
                  Severity: {ticket.severity}
                </Badge>
              )}
              {ticket.tags?.map((tag: string) => (
                <Badge key={tag} variant="secondary" className="text-xs">
                  {tag}
                </Badge>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              Opened {createdAt}
            </p>
          </div>

          {/* Actions dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5 shrink-0">
                Actions
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={handleEscalate} className="gap-2">
                <TrendingUp className="h-4 w-4 text-orange-500" />
                Escalate Priority
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setReassignOpen(true)} className="gap-2">
                <UserCheck className="h-4 w-4 text-blue-500" />
                Reassign
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setDeleteOpen(true)}
                className="gap-2 text-destructive focus:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
                Delete Ticket
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Main grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* ── Left: Conversation ─────────────────────────────────────── */}
          <div className="lg:col-span-2 flex flex-col gap-5">
            <Card className="flex flex-col">
              <CardHeader className="pb-3 border-b">
                <CardTitle className="text-base flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-muted-foreground" />
                  Conversation
                  <Badge variant="secondary" className="ml-auto text-xs">
                    {messages.length} {messages.length === 1 ? "message" : "messages"}
                  </Badge>
                </CardTitle>
              </CardHeader>

              <CardContent className="p-4 flex-1">
                {/* Messages list */}
                <div className="space-y-4 max-h-[480px] overflow-y-auto pr-1 mb-4">
                  {messages.length === 0 ? (
                    <div className="text-center py-12">
                      <MessageSquare className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                      <p className="text-sm text-muted-foreground">
                        No messages yet. Send the first reply below.
                      </p>
                    </div>
                  ) : (
                    messages.map((msg, i) => <MessageBubble key={msg.id ?? i} msg={msg} />)
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Reply form */}
                <div className="border-t pt-4 space-y-3">
                  {/* Toggle: Public / Internal */}
                  <div className="flex items-center gap-1 rounded-lg border p-0.5 bg-muted/40 w-fit">
                    <button
                      type="button"
                      onClick={() => setIsInternal(false)}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                        !isInternal
                          ? "bg-background shadow-sm text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <Send className="h-3 w-3" />
                      Public Reply
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsInternal(true)}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                        isInternal
                          ? "bg-amber-100 shadow-sm text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <Lock className="h-3 w-3" />
                      Internal Note
                    </button>
                  </div>

                  <Textarea
                    placeholder={
                      isInternal
                        ? "Write an internal note (only visible to your team)..."
                        : "Type your reply to the customer..."
                    }
                    value={replyContent}
                    onChange={(e) => setReplyContent(e.target.value)}
                    className={`min-h-[100px] resize-none text-sm ${
                      isInternal ? "border-amber-300 dark:border-amber-700 bg-amber-50/30 dark:bg-amber-950/10" : ""
                    }`}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleSendReply();
                    }}
                  />

                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">
                      {isInternal ? (
                        <span className="flex items-center gap-1">
                          <Shield className="h-3 w-3" />
                          Visible only to agents
                        </span>
                      ) : (
                        <span>Ctrl+Enter to send</span>
                      )}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setReplyContent("")}
                        disabled={!replyContent}
                      >
                        Clear
                      </Button>
                      <Button
                        size="sm"
                        className="gap-1.5"
                        onClick={handleSendReply}
                        disabled={!replyContent.trim() || sending}
                      >
                        <Send className="h-3.5 w-3.5" />
                        {sending ? "Sending…" : isInternal ? "Add Note" : "Send Reply"}
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* ── Right: Sidebar ─────────────────────────────────────────── */}
          <div className="space-y-4">
            {/* Properties */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Properties</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">Status</p>
                  <Select value={ticket.status} onValueChange={handleStatusChange}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value} className="text-xs">
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">Priority</p>
                  <Select value={ticket.priority ?? "normal"} onValueChange={handlePriorityChange}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PRIORITY_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value} className="text-xs">
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {ticket.severity && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Severity</p>
                    <Badge variant="outline" className="text-xs capitalize">
                      {ticket.severity}
                    </Badge>
                  </div>
                )}

                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">Assigned to</p>
                  <button
                    type="button"
                    onClick={() => setReassignOpen(true)}
                    className="flex items-center gap-2 w-full text-left group"
                  >
                    <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <User className="h-3.5 w-3.5 text-primary" />
                    </div>
                    <span className="text-xs font-medium group-hover:text-primary transition-colors truncate">
                      {ticket.assignee?.name ?? "Unassigned"}
                    </span>
                    <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 ml-auto" />
                  </button>
                </div>

                {ticket.sla && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">SLA Tier</p>
                    <Badge variant="outline" className="text-xs">
                      {ticket.sla.name}
                    </Badge>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Customer */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Customer</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {ticket.contact ? (
                  <>
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary/60 to-primary flex items-center justify-center text-primary-foreground text-xs font-bold flex-shrink-0">
                        {(ticket.contact.name ?? ticket.contact.firstName ?? "?")
                          .split(" ")
                          .map((n: string) => n[0])
                          .join("")
                          .toUpperCase()
                          .slice(0, 2)}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-sm truncate">
                          {ticket.contact.name ??
                            `${ticket.contact.firstName ?? ""} ${ticket.contact.lastName ?? ""}`.trim()}
                        </p>
                        {ticket.contact.email && (
                          <p className="text-xs text-muted-foreground truncate">{ticket.contact.email}</p>
                        )}
                      </div>
                    </div>
                    {ticket.contact.phone && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Phone className="h-3.5 w-3.5 flex-shrink-0" />
                        {ticket.contact.phone}
                      </div>
                    )}
                    {ticket.company && (
                      <div className="text-xs text-muted-foreground border-t pt-2">
                        Company:{" "}
                        <span className="font-medium text-foreground">{ticket.company.name}</span>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground italic">No contact linked</p>
                )}
              </CardContent>
            </Card>

            {/* SLA Tracking */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  SLA Tracking
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">First Response</span>
                  {ticket.firstResponseAt ? (
                    <span className="font-semibold text-green-600 dark:text-green-400">
                      ✓ {new Date(ticket.firstResponseAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  ) : slaFirstResponseTarget ? (
                    <SLATimer targetDate={slaFirstResponseTarget} />
                  ) : (
                    <span className="text-muted-foreground">Pending</span>
                  )}
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Resolution</span>
                  {ticket.resolvedAt ? (
                    <span className="font-semibold text-green-600 dark:text-green-400">
                      ✓ {new Date(ticket.resolvedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  ) : slaResolutionTarget ? (
                    <SLATimer targetDate={slaResolutionTarget} />
                  ) : (
                    <span className="text-muted-foreground">Pending</span>
                  )}
                </div>

                {ticket.closedAt && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Closed</span>
                    <span className="font-mono font-semibold">
                      {new Date(ticket.closedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* ── Reassign Dialog ──────────────────────────────────────────── */}
      <Dialog open={reassignOpen} onOpenChange={setReassignOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserCheck className="h-5 w-5 text-blue-500" />
              Reassign Ticket
            </DialogTitle>
            <DialogDescription>
              Select an agent to handle this ticket.
            </DialogDescription>
          </DialogHeader>

          <Select value={selectedAssignee} onValueChange={setSelectedAssignee}>
            <SelectTrigger>
              <SelectValue placeholder="Select agent..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unassigned">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <User className="h-3.5 w-3.5" />
                  Unassigned
                </span>
              </SelectItem>
              {agents.map((agent) => (
                <SelectItem key={agent.id} value={agent.id}>
                  <span className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center text-[9px] font-bold text-primary">
                      {(agent.name ?? agent.email ?? "?")
                        .split(" ")
                        .map((n: string) => n[0])
                        .join("")
                        .toUpperCase()
                        .slice(0, 2)}
                    </div>
                    {agent.name ?? agent.email}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <DialogFooter>
            <Button variant="outline" onClick={() => setReassignOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleReassign} disabled={reassigning}>
              {reassigning ? "Reassigning…" : "Reassign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirmation Dialog ───────────────────────────────── */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              Delete Ticket
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to delete{" "}
              <span className="font-semibold text-foreground">{ticket.ticketNumber}</span>?
              This will permanently remove the ticket and all its messages.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete Ticket"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
