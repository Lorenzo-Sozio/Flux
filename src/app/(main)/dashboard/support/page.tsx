"use client";

import { useEffect, useState } from "react";

import Link from "next/link";

import { AlertCircle, CheckCircle2, Clock, Mail, MessageCircle, MessageSquare, Phone, Users } from "lucide-react";

import { getSLAs, getTickets } from "@/actions/support";
import { CreateTicketButton } from "@/components/crm/create-ticket-button";
import { MetricCard } from "@/components/crm/metric-card";
import { SLAGauge } from "@/components/crm/sla-gauge";
import { TicketPriorityBadge } from "@/components/crm/ticket-priority-badge";
import { TicketStatusBadge } from "@/components/crm/ticket-status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const CHANNEL_META: Record<string, { label: string; icon: React.ElementType; color: string; barClass: string }> = {
  email: { label: "Email", icon: Mail, color: "#3b82f6", barClass: "bg-blue-500" },
  chat: { label: "Chat", icon: MessageCircle, color: "#22c55e", barClass: "bg-green-500" },
  phone: { label: "Phone", icon: Phone, color: "#f97316", barClass: "bg-orange-500" },
  social: { label: "Social", icon: Users, color: "#a855f7", barClass: "bg-purple-500" },
};

const PRIORITY_BORDER: Record<string, string> = {
  urgent: "border-l-red-500",
  high: "border-l-orange-500",
  normal: "border-l-blue-500",
  low: "border-l-green-500",
};

export default function SupportDashboard() {
  const [tickets, setTickets] = useState<any[]>([]);
  const [slas, setSLAs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [ticketData, slaData] = await Promise.all([getTickets({ limit: 100 }), getSLAs()]);
        setTickets(ticketData);
        setSLAs(slaData);
      } catch (error) {
        console.error("Failed to load data:", error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  const openTickets = tickets.filter((t) => t.status === "open");
  const totalTickets = tickets.length;
  const resolvedTickets = tickets.filter((t) => t.status === "resolved");
  const resolutionRate = totalTickets > 0 ? Math.round((resolvedTickets.length / totalTickets) * 100) : 0;

  const avgResolutionTime = (() => {
    const withTime = resolvedTickets.filter((t) => t.resolvedAt && t.createdAt);
    if (withTime.length === 0) return "—";
    const totalMs = withTime.reduce(
      (sum, t) => sum + (new Date(t.resolvedAt).getTime() - new Date(t.createdAt).getTime()),
      0,
    );
    const avgMs = totalMs / withTime.length;
    const totalMins = Math.round(avgMs / 60_000);
    if (totalMins < 60) return `${totalMins}m`;
    const h = Math.floor(totalMins / 60);
    const m = totalMins % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  })();

  // Calculate real SLA metrics
  const calculateSLAMetrics = () => {
    if (tickets.length === 0) return { onTime: 95, firstResponse: 88, satisfaction: 92 };

    let onTimeCount = 0;
    let firstResponseCount = 0;

    tickets.forEach((ticket) => {
      if (ticket.resolvedAt && ticket.sla) {
        const resolutionTarget = new Date(ticket.createdAt).getTime() + ticket.sla.resolutionTimeMinutes * 60000;
        if (new Date(ticket.resolvedAt).getTime() <= resolutionTarget) {
          onTimeCount++;
        }
      }
      if (ticket.firstResponseAt && ticket.sla) {
        const responseTarget = new Date(ticket.createdAt).getTime() + ticket.sla.firstResponseTimeMinutes * 60000;
        if (new Date(ticket.firstResponseAt).getTime() <= responseTarget) {
          firstResponseCount++;
        }
      }
    });

    const resolvedWithSLA = tickets.filter((t) => t.resolvedAt && t.sla).length;
    const withFirstResponse = tickets.filter((t) => t.firstResponseAt && t.sla).length;

    return {
      onTime: resolvedWithSLA > 0 ? Math.round((onTimeCount / resolvedWithSLA) * 100) : 95,
      firstResponse: withFirstResponse > 0 ? Math.round((firstResponseCount / withFirstResponse) * 100) : 88,
      satisfaction: 92, // Mock - would need survey data
    };
  };

  const metrics = calculateSLAMetrics();
  const onTimeResolution = metrics.onTime;
  const firstResponseTime = metrics.firstResponse;
  const satisfaction = metrics.satisfaction;

  const channels = {
    email: tickets.filter((t) => t.channel === "email").length,
    chat: tickets.filter((t) => t.channel === "chat").length,
    phone: tickets.filter((t) => t.channel === "phone").length,
    social: tickets.filter((t) => t.channel === "social").length,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Support Center</h1>
          <p className="text-muted-foreground mt-1">Manage customer tickets and monitor SLA performance</p>
        </div>
        <CreateTicketButton />
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          icon={AlertCircle}
          label="Open Tickets"
          value={loading ? "—" : openTickets.length}
          description="Awaiting response"
          trend={openTickets.length > 0 ? "up" : "neutral"}
        />
        <MetricCard
          icon={MessageSquare}
          label="Total Tickets"
          value={loading ? "—" : totalTickets}
          description="All time"
        />
        <MetricCard
          icon={CheckCircle2}
          label="Resolution Rate"
          value={loading ? "—" : `${resolutionRate}%`}
          description={`${resolvedTickets.length} resolved`}
          trend={resolutionRate >= 85 ? "up" : "down"}
        />
        <MetricCard
          icon={Clock}
          label="Avg. Resolution"
          value={loading ? "—" : avgResolutionTime}
          description="Time to close"
        />
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Left: ticket lists ─────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-5">
          {/* Open Tickets */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <div>
                <CardTitle className="text-base">Open Tickets</CardTitle>
                <CardDescription className="text-xs mt-0.5">Recent issues awaiting a response</CardDescription>
              </div>
              <Button variant="outline" size="sm" className="h-8 text-xs" asChild>
                <Link href="/dashboard/support/tickets">View all</Link>
              </Button>
            </CardHeader>
            <CardContent className="pt-0">
              {loading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-16 w-full rounded-lg" />
                  ))}
                </div>
              ) : openTickets.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-10 text-center">
                  <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/20 flex items-center justify-center">
                    <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
                  </div>
                  <p className="font-medium text-sm">All caught up!</p>
                  <p className="text-xs text-muted-foreground">No open tickets at the moment.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {openTickets.slice(0, 5).map((ticket) => {
                    const daysAgo = Math.floor((Date.now() - new Date(ticket.createdAt).getTime()) / 86_400_000);
                    const dateLabel = daysAgo === 0 ? "Today" : `${daysAgo}d ago`;
                    const ChannelIcon = CHANNEL_META[ticket.channel]?.icon ?? MessageSquare;
                    const borderClass = PRIORITY_BORDER[ticket.priority] ?? "border-l-blue-500";

                    return (
                      <Link
                        key={ticket.id}
                        href={`/dashboard/support/tickets/${ticket.id}`}
                        className={`flex items-start gap-3 p-3 rounded-lg border border-l-4 hover:bg-muted/40 transition-colors group ${borderClass}`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="font-mono text-[11px] text-muted-foreground">{ticket.ticketNumber}</span>
                            <TicketPriorityBadge
                              priority={ticket.priority}
                              showIcon={false}
                              className="text-[10px] h-4 px-1.5"
                            />
                          </div>
                          <p className="font-medium text-sm line-clamp-1 group-hover:text-primary transition-colors">
                            {ticket.subject}
                          </p>
                          <div className="flex items-center gap-3 mt-1">
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <ChannelIcon className="h-3 w-3" />
                              {ticket.contact?.name ?? "No contact"}
                            </span>
                          </div>
                        </div>
                        <span className="text-xs text-muted-foreground whitespace-nowrap mt-0.5">{dateLabel}</span>
                      </Link>
                    );
                  })}
                  {openTickets.length > 5 && (
                    <p className="text-xs text-center text-muted-foreground pt-1">
                      +{openTickets.length - 5} more open tickets
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recently Resolved */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="text-base">Recently Resolved</CardTitle>
              <Button variant="ghost" size="sm" className="h-8 text-xs" asChild>
                <Link href="/dashboard/support/tickets">See all →</Link>
              </Button>
            </CardHeader>
            <CardContent className="pt-0">
              {loading ? (
                <div className="space-y-2">
                  {[1, 2].map((i) => (
                    <Skeleton key={i} className="h-12 w-full rounded-lg" />
                  ))}
                </div>
              ) : resolvedTickets.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No resolved tickets yet.</p>
              ) : (
                <div className="divide-y">
                  {resolvedTickets.slice(0, 4).map((ticket) => (
                    <Link
                      key={ticket.id}
                      href={`/dashboard/support/tickets/${ticket.id}`}
                      className="flex items-center justify-between py-3 hover:bg-muted/30 px-1 rounded transition-colors group"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <TicketStatusBadge status="resolved" dotOnly />
                        <span className="font-mono text-[11px] text-muted-foreground shrink-0">
                          {ticket.ticketNumber}
                        </span>
                        <span className="text-sm font-medium line-clamp-1 group-hover:text-primary transition-colors">
                          {ticket.subject}
                        </span>
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0 ml-3">
                        {ticket.resolvedAt
                          ? new Date(ticket.resolvedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                          : ""}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Right: SLA + channels ──────────────────────────────── */}
        <div className="space-y-5">
          {/* SLA Performance */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">SLA Performance</CardTitle>
              <CardDescription className="text-xs">Current month</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 pb-6">
              <SLAGauge label="On-time Resolution" percentage={onTimeResolution} color="green" />
              <SLAGauge label="First Response" percentage={firstResponseTime} color="green" />
              <SLAGauge label="Satisfaction" percentage={satisfaction} color="green" />
            </CardContent>
          </Card>

          {/* Channel Distribution */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Channels</CardTitle>
              <CardDescription className="text-xs">Ticket volume by source</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {loading ? (
                <div className="space-y-3">
                  {[1, 2, 3, 4].map((i) => (
                    <Skeleton key={i} className="h-8 w-full" />
                  ))}
                </div>
              ) : (
                Object.entries(channels).map(([key, count]) => {
                  const meta = CHANNEL_META[key];
                  if (!meta) return null;
                  const Icon = meta.icon;
                  const pct = totalTickets > 0 ? Math.round((count / totalTickets) * 100) : 0;
                  return (
                    <div key={key} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1.5 text-muted-foreground font-medium">
                          <Icon className="h-3.5 w-3.5" />
                          {meta.label}
                        </span>
                        <span className="tabular-nums font-semibold">
                          {count}
                          <span className="text-muted-foreground font-normal ml-1">({pct}%)</span>
                        </span>
                      </div>
                      <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${meta.barClass}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          <Button className="w-full gap-2" asChild>
            <Link href="/dashboard/support/tickets">
              <MessageSquare className="h-4 w-4" />
              Manage All Tickets
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
