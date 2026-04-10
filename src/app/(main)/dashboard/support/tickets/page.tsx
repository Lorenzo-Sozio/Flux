"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUpDown,
  ChevronLeft,
  Kanban,
  LayoutList,
  Mail,
  MessageCircle,
  MessageSquare,
  Phone,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TicketStatusBadge } from "@/components/crm/ticket-status-badge";
import { TicketPriorityBadge } from "@/components/crm/ticket-priority-badge";
import { TicketKanbanBoard } from "@/components/crm/ticket-kanban-board";
import { getTickets } from "@/actions/support";
import { CreateTicketButton } from "@/components/crm/create-ticket-button";

type SortField = "createdAt" | "subject" | "status" | "priority";
type SortOrder = "asc" | "desc";
type ViewMode = "list" | "kanban";

const CHANNEL_ICONS: Record<string, React.ReactNode> = {
  email:  <Mail className="h-3.5 w-3.5" />,
  chat:   <MessageCircle className="h-3.5 w-3.5" />,
  phone:  <Phone className="h-3.5 w-3.5" />,
  social: <Users className="h-3.5 w-3.5" />,
};

const STATUS_TABS = [
  { value: "all",         label: "All" },
  { value: "open",        label: "Open" },
  { value: "in_progress", label: "In Progress" },
  { value: "waiting",     label: "Waiting" },
  { value: "resolved",    label: "Resolved" },
  { value: "closed",      label: "Closed" },
] as const;

export default function TicketsListPage() {
  const router = useRouter();
  const [tickets, setTickets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewMode>("list");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  const loadTickets = async () => {
    try {
      const data = await getTickets({ limit: 200 });
      setTickets(data);
    } catch (error) {
      console.error("Failed to load tickets:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadTickets(); }, []);

  const statusCounts = useMemo(() => ({
    all:         tickets.length,
    open:        tickets.filter((t) => t.status === "open").length,
    in_progress: tickets.filter((t) => t.status === "in_progress").length,
    waiting:     tickets.filter((t) => t.status === "waiting").length,
    resolved:    tickets.filter((t) => t.status === "resolved").length,
    closed:      tickets.filter((t) => t.status === "closed").length,
  }), [tickets]);

  const filteredTickets = useMemo(() => {
    let filtered = [...tickets];

    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(
        (t) =>
          t.ticketNumber?.toLowerCase().includes(q) ||
          t.subject?.toLowerCase().includes(q) ||
          t.contact?.name?.toLowerCase().includes(q)
      );
    }
    if (statusFilter !== "all") filtered = filtered.filter((t) => t.status === statusFilter);
    if (priorityFilter !== "all") filtered = filtered.filter((t) => t.priority === priorityFilter);
    if (channelFilter !== "all") filtered = filtered.filter((t) => t.channel === channelFilter);

    filtered.sort((a, b) => {
      const av = a[sortField];
      const bv = b[sortField];
      const cmp = typeof av === "string" ? av.localeCompare(bv) : av > bv ? 1 : -1;
      return sortOrder === "asc" ? cmp : -cmp;
    });

    return filtered;
  }, [tickets, search, statusFilter, priorityFilter, channelFilter, sortField, sortOrder]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortOrder("asc"); }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Link
          href="/dashboard/support"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          Support Center
        </Link>
        <CreateTicketButton />
      </div>

      {/* Title + View Toggle */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Support Tickets</h1>
          <p className="text-muted-foreground mt-1">
            {statusCounts.all} total &middot;{" "}
            <span className="text-blue-600 dark:text-blue-400 font-medium">{statusCounts.open} open</span>
          </p>
        </div>
        <div className="flex items-center rounded-lg border p-0.5 bg-muted/50 gap-0.5 shrink-0">
          <Button
            variant={view === "list" ? "default" : "ghost"}
            size="sm"
            className="h-7 px-2.5 gap-1.5"
            onClick={() => setView("list")}
          >
            <LayoutList className="h-3.5 w-3.5" />
            <span className="text-xs">List</span>
          </Button>
          <Button
            variant={view === "kanban" ? "default" : "ghost"}
            size="sm"
            className="h-7 px-2.5 gap-1.5"
            onClick={() => setView("kanban")}
          >
            <Kanban className="h-3.5 w-3.5" />
            <span className="text-xs">Kanban</span>
          </Button>
        </div>
      </div>

      {/* Status tabs */}
      <div className="flex gap-1 border-b overflow-x-auto pb-0 scrollbar-none">
        {STATUS_TABS.map((tab) => {
          const count = statusCounts[tab.value as keyof typeof statusCounts];
          const active = statusFilter === tab.value;
          return (
            <button
              key={tab.value}
              onClick={() => setStatusFilter(tab.value)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30"
              }`}
            >
              {tab.label}
              <span
                className={`rounded-full text-[10px] px-1.5 py-0.5 font-semibold ${
                  active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <Input
          placeholder="Search by ticket #, subject, or customer..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 h-9"
        />
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="w-full sm:w-36 h-9">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Priority</SelectItem>
            <SelectItem value="urgent">Urgent</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="normal">Normal</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>
        <Select value={channelFilter} onValueChange={setChannelFilter}>
          <SelectTrigger className="w-full sm:w-36 h-9">
            <SelectValue placeholder="Channel" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Channels</SelectItem>
            <SelectItem value="email">Email</SelectItem>
            <SelectItem value="chat">Chat</SelectItem>
            <SelectItem value="phone">Phone</SelectItem>
            <SelectItem value="social">Social</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Content */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-14 bg-muted rounded-lg animate-pulse" />
          ))}
        </div>
      ) : view === "kanban" ? (
        <TicketKanbanBoard initialTickets={filteredTickets} />
      ) : (
        <Card>
          <CardContent className="p-0">
            {filteredTickets.length === 0 ? (
              <div className="text-center py-16">
                <MessageSquare className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
                <p className="text-muted-foreground">No tickets match your filters.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead
                        className="cursor-pointer select-none w-36"
                        onClick={() => toggleSort("createdAt")}
                      >
                        <div className="flex items-center gap-1.5">
                          Ticket #
                          <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
                        </div>
                      </TableHead>
                      <TableHead
                        className="cursor-pointer select-none"
                        onClick={() => toggleSort("subject")}
                      >
                        <div className="flex items-center gap-1.5">
                          Subject
                          <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
                        </div>
                      </TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead
                        className="cursor-pointer select-none w-32"
                        onClick={() => toggleSort("status")}
                      >
                        <div className="flex items-center gap-1.5">
                          Status
                          <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
                        </div>
                      </TableHead>
                      <TableHead
                        className="cursor-pointer select-none w-28"
                        onClick={() => toggleSort("priority")}
                      >
                        <div className="flex items-center gap-1.5">
                          Priority
                          <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
                        </div>
                      </TableHead>
                      <TableHead className="w-20">Channel</TableHead>
                      <TableHead className="w-20">Msgs</TableHead>
                      <TableHead className="w-28">Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredTickets.map((ticket) => {
                      const createdDate = new Date(ticket.createdAt);
                      const isToday = createdDate.toDateString() === new Date().toDateString();
                      const daysAgo = Math.floor(
                        (Date.now() - createdDate.getTime()) / 86_400_000
                      );
                      const dateLabel = isToday ? "Today" : `${daysAgo}d ago`;
                      const msgCount = ticket.messages?.length ?? 0;

                      return (
                        <TableRow
                          key={ticket.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => router.push(`/dashboard/support/tickets/${ticket.id}`)}
                        >
                          <TableCell className="font-mono text-xs font-semibold text-muted-foreground">
                            {ticket.ticketNumber}
                          </TableCell>
                          <TableCell className="max-w-xs">
                            <span className="line-clamp-1 font-medium">{ticket.subject}</span>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {ticket.contact?.name ?? "—"}
                          </TableCell>
                          <TableCell>
                            <TicketStatusBadge status={ticket.status} />
                          </TableCell>
                          <TableCell>
                            <TicketPriorityBadge priority={ticket.priority} />
                          </TableCell>
                          <TableCell>
                            <span className="flex items-center gap-1 text-muted-foreground text-xs capitalize">
                              {CHANNEL_ICONS[ticket.channel]}
                              {ticket.channel}
                            </span>
                          </TableCell>
                          <TableCell>
                            {msgCount > 0 ? (
                              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                <MessageSquare className="h-3.5 w-3.5" />
                                {msgCount}
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground/40">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {dateLabel}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Pagination info */}
      {!loading && filteredTickets.length > 0 && (
        <p className="text-center text-xs text-muted-foreground">
          Showing {filteredTickets.length} of {statusCounts.all} tickets
        </p>
      )}
    </div>
  );
}
