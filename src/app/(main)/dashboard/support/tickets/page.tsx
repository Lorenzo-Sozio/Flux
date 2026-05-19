"use client";

import { useEffect, useMemo, useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  ArrowUpDown,
  BookOpen,
  ChevronLeft,
  Kanban,
  LayoutList,
  Mail,
  MessageCircle,
  MessageSquare,
  Phone,
  Users,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { getTickets } from "@/actions/support";
import { CreateTicketButton } from "@/components/crm/create-ticket-button";
import { TicketKanbanBoard } from "@/components/crm/ticket-kanban-board";
import { TicketPriorityBadge } from "@/components/crm/ticket-priority-badge";
import { TicketStatusBadge } from "@/components/crm/ticket-status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type SortField = "createdAt" | "subject" | "status" | "priority";
type SortOrder = "asc" | "desc";
type ViewMode = "list" | "kanban";

const CHANNEL_ICONS: Record<string, React.ReactNode> = {
  email: <Mail className="h-3.5 w-3.5" />,
  chat: <MessageCircle className="h-3.5 w-3.5" />,
  phone: <Phone className="h-3.5 w-3.5" />,
  social: <Users className="h-3.5 w-3.5" />,
};

const STATUS_TAB_VALUES = ["all", "open", "in_progress", "waiting", "resolved", "closed"] as const;
type StatusTabValue = (typeof STATUS_TAB_VALUES)[number];

export default function TicketsListPage() {
  const t = useTranslations("support.tickets");
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

  useEffect(() => {
    loadTickets();
  }, []);

  const statusCounts = useMemo(
    () => ({
      all: tickets.length,
      open: tickets.filter((t) => t.status === "open").length,
      in_progress: tickets.filter((t) => t.status === "in_progress").length,
      waiting: tickets.filter((t) => t.status === "waiting").length,
      resolved: tickets.filter((t) => t.status === "resolved").length,
      closed: tickets.filter((t) => t.status === "closed").length,
    }),
    [tickets],
  );

  const filteredTickets = useMemo(() => {
    let filtered = [...tickets];

    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(
        (t) =>
          t.ticketNumber?.toLowerCase().includes(q) ||
          t.subject?.toLowerCase().includes(q) ||
          t.contact?.name?.toLowerCase().includes(q),
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
    else {
      setSortField(field);
      setSortOrder("asc");
    }
  };

  return (
    <div className={view === "kanban" ? "p-6 h-full flex flex-col gap-6" : "p-6 space-y-6"}>
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <Link
          href="/dashboard/support"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          {t("supportCenter")}
        </Link>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/dashboard/settings/macros">
              <BookOpen className="mr-2 h-4 w-4" />
              {t("macros")}
            </Link>
          </Button>
          <CreateTicketButton />
        </div>
      </div>

      {/* Title + View Toggle */}
      <div className="flex items-start justify-between gap-4 shrink-0">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("supportTickets")}</h1>
          <p className="text-muted-foreground mt-1">
            {t("totalOpen", { total: statusCounts.all, open: statusCounts.open })}
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
            <span className="text-xs">{t("listView")}</span>
          </Button>
          <Button
            variant={view === "kanban" ? "default" : "ghost"}
            size="sm"
            className="h-7 px-2.5 gap-1.5"
            onClick={() => setView("kanban")}
          >
            <Kanban className="h-3.5 w-3.5" />
            <span className="text-xs">{t("kanbanView")}</span>
          </Button>
        </div>
      </div>

      {/* Status tabs */}
      <div className="flex gap-1 border-b overflow-x-auto pb-0 scrollbar-none shrink-0">
        {STATUS_TAB_VALUES.map((value) => {
          const count = statusCounts[value as keyof typeof statusCounts];
          const active = statusFilter === value;
          const statusLabels: Record<StatusTabValue, string> = {
            all: t("statusAll"),
            open: t("statuses.open"),
            in_progress: t("statusInProgress"),
            waiting: t("statusWaiting"),
            resolved: t("statuses.resolved"),
            closed: t("statuses.closed"),
          };
          return (
            <button
              key={value}
              onClick={() => setStatusFilter(value)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30"
              }`}
            >
              {statusLabels[value]}
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
      <div className="flex flex-col sm:flex-row gap-2 shrink-0">
        <Input
          placeholder={t("searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 h-9"
        />
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="w-full sm:w-36 h-9">
            <SelectValue placeholder={t("priority")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("allPriority")}</SelectItem>
            <SelectItem value="urgent">{t("priorities.urgent")}</SelectItem>
            <SelectItem value="high">{t("priorities.high")}</SelectItem>
            <SelectItem value="normal">{t("priorities.normal")}</SelectItem>
            <SelectItem value="low">{t("priorities.low")}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={channelFilter} onValueChange={setChannelFilter}>
          <SelectTrigger className="w-full sm:w-36 h-9">
            <SelectValue placeholder={t("channel")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("allChannels")}</SelectItem>
            <SelectItem value="email">{t("channels.email")}</SelectItem>
            <SelectItem value="chat">{t("channels.chat")}</SelectItem>
            <SelectItem value="phone">{t("channels.phone")}</SelectItem>
            <SelectItem value="social">{t("channels.social")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Content */}
      <div className={view === "kanban" ? "flex-1 min-h-0" : undefined}>
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
                  <p className="text-muted-foreground">{t("noTicketsFilter")}</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="cursor-pointer select-none w-36" onClick={() => toggleSort("createdAt")}>
                          <div className="flex items-center gap-1.5">
                            {t("colTicketNum")}
                            <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
                          </div>
                        </TableHead>
                        <TableHead className="cursor-pointer select-none" onClick={() => toggleSort("subject")}>
                          <div className="flex items-center gap-1.5">
                            {t("subject")}
                            <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
                          </div>
                        </TableHead>
                        <TableHead>{t("colCustomer")}</TableHead>
                        <TableHead className="cursor-pointer select-none w-32" onClick={() => toggleSort("status")}>
                          <div className="flex items-center gap-1.5">
                            {t("columns.status")}
                            <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
                          </div>
                        </TableHead>
                        <TableHead className="cursor-pointer select-none w-28" onClick={() => toggleSort("priority")}>
                          <div className="flex items-center gap-1.5">
                            {t("priority")}
                            <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
                          </div>
                        </TableHead>
                        <TableHead className="w-20">{t("colChannel")}</TableHead>
                        <TableHead className="w-20">{t("colMsgs")}</TableHead>
                        <TableHead className="w-28">{t("columns.created")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredTickets.map((ticket) => {
                        const createdDate = new Date(ticket.createdAt);
                        const isToday = createdDate.toDateString() === new Date().toDateString();
                        const daysAgo = Math.floor((Date.now() - createdDate.getTime()) / 86_400_000);
                        const dateLabel = isToday ? t("dateToday") : t("daysAgo", { count: daysAgo });
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
                            <TableCell className="text-xs text-muted-foreground">{dateLabel}</TableCell>
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
      </div>

      {/* Pagination info */}
      {!loading && view === "list" && filteredTickets.length > 0 && (
        <p className="text-center text-xs text-muted-foreground shrink-0">
          {t("showingTickets", { shown: filteredTickets.length, total: statusCounts.all })}
        </p>
      )}
    </div>
  );
}
