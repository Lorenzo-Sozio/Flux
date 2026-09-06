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
import { EmptyState } from "@/components/crm/empty-state";
import { RecordCards, ResponsiveRecordList } from "@/components/crm/record-cards";
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
  const te = useTranslations("emptyStates");
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

  // `loadTickets` is redefined on every render, so depending on it would fetch
  // the list again on every render, for ever.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, on mount
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

  /** "Today", or how many days ago — the way somebody talks about a ticket. */
  function ticketDateLabel(createdAt: Date | string): string {
    const created = new Date(createdAt);
    if (created.toDateString() === new Date().toDateString()) return t("dateToday");
    return t("daysAgo", { count: Math.floor((Date.now() - created.getTime()) / 86_400_000) });
  }

  return (
    <div className={view === "kanban" ? "flex h-full flex-col gap-6" : "space-y-6"}>
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between">
        <Link
          href="/dashboard/support"
          className="inline-flex items-center gap-1.5 font-medium text-muted-foreground text-sm transition-colors hover:text-foreground"
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
      <div className="flex shrink-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-bold text-2xl tracking-tight sm:text-3xl">{t("supportTickets")}</h1>
          <p className="mt-1 text-muted-foreground">
            {t("totalOpen", { total: statusCounts.all, open: statusCounts.open })}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5 rounded-lg border bg-muted/50 p-0.5">
          <Button
            variant={view === "list" ? "default" : "ghost"}
            size="sm"
            className="h-7 gap-1.5 px-2.5"
            onClick={() => setView("list")}
          >
            <LayoutList className="h-3.5 w-3.5" />
            <span className="text-xs">{t("listView")}</span>
          </Button>
          <Button
            variant={view === "kanban" ? "default" : "ghost"}
            size="sm"
            className="h-7 gap-1.5 px-2.5"
            onClick={() => setView("kanban")}
          >
            <Kanban className="h-3.5 w-3.5" />
            <span className="text-xs">{t("kanbanView")}</span>
          </Button>
        </div>
      </div>

      {/* Status tabs */}
      <div className="scrollbar-none flex shrink-0 gap-1 overflow-x-auto border-b pb-0">
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
              type="button"
              onClick={() => setStatusFilter(value)}
              className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 font-medium text-sm transition-colors ${
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:border-muted-foreground/30 hover:text-foreground"
              }`}
            >
              {statusLabels[value]}
              <span
                className={`rounded-full px-1.5 py-0.5 font-semibold text-[10px] ${
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
      <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
        <Input
          placeholder={t("searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 flex-1"
        />
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="h-9 w-full sm:w-36">
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
          <SelectTrigger className="h-9 w-full sm:w-36">
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
      <div className={view === "kanban" ? "min-h-0 flex-1" : undefined}>
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : view === "kanban" ? (
          <TicketKanbanBoard initialTickets={filteredTickets} />
        ) : (
          <Card>
            <CardContent className="p-0">
              {filteredTickets.length === 0 ? (
                tickets.length === 0 ? (
                  <EmptyState
                    icon={MessageSquare}
                    title={te("tickets.title")}
                    description={te("tickets.description")}
                    action={<CreateTicketButton />}
                  />
                ) : (
                  <EmptyState
                    icon={MessageSquare}
                    title={te("filteredTitle")}
                    description={te("filteredDescription")}
                  />
                )
              ) : (
                <ResponsiveRecordList
                  cards={
                    <RecordCards
                      className="p-2"
                      items={filteredTickets.map((ticket) => ({
                        id: ticket.id,
                        href: `/dashboard/support/tickets/${ticket.id}`,
                        title: ticket.subject,
                        subtitle: (
                          <span className="font-mono">
                            {ticket.ticketNumber}
                            {ticket.contact?.name ? ` · ${ticket.contact.name}` : ""}
                          </span>
                        ),
                        badge: <TicketPriorityBadge priority={ticket.priority} />,
                        fields: [
                          { label: t("status"), value: <TicketStatusBadge status={ticket.status} /> },
                          { label: t("columns.created"), value: ticketDateLabel(ticket.createdAt) },
                        ],
                      }))}
                    />
                  }
                  table={
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="hover:bg-transparent">
                            <TableHead
                              className="w-36 cursor-pointer select-none"
                              onClick={() => toggleSort("createdAt")}
                            >
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
                            <TableHead className="w-32 cursor-pointer select-none" onClick={() => toggleSort("status")}>
                              <div className="flex items-center gap-1.5">
                                {t("columns.status")}
                                <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
                              </div>
                            </TableHead>
                            <TableHead
                              className="w-28 cursor-pointer select-none"
                              onClick={() => toggleSort("priority")}
                            >
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
                            const dateLabel = ticketDateLabel(ticket.createdAt);
                            const msgCount = ticket.messages?.length ?? 0;

                            return (
                              <TableRow
                                key={ticket.id}
                                className="cursor-pointer hover:bg-muted/50"
                                onClick={() => router.push(`/dashboard/support/tickets/${ticket.id}`)}
                              >
                                <TableCell className="font-mono font-semibold text-muted-foreground text-xs">
                                  {ticket.ticketNumber}
                                </TableCell>
                                <TableCell className="max-w-xs">
                                  <span className="line-clamp-1 font-medium">{ticket.subject}</span>
                                </TableCell>
                                <TableCell className="text-muted-foreground text-sm">
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
                                    <span className="flex items-center gap-1 text-muted-foreground text-xs">
                                      <MessageSquare className="h-3.5 w-3.5" />
                                      {msgCount}
                                    </span>
                                  ) : (
                                    <span className="text-muted-foreground/40 text-xs">—</span>
                                  )}
                                </TableCell>
                                <TableCell className="text-muted-foreground text-xs">{dateLabel}</TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  }
                />
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Pagination info */}
      {!loading && view === "list" && filteredTickets.length > 0 && (
        <p className="shrink-0 text-center text-muted-foreground text-xs">
          {t("showingTickets", { shown: filteredTickets.length, total: statusCounts.all })}
        </p>
      )}
    </div>
  );
}
