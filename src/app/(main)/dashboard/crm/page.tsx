import Link from "next/link";

import { and, desc, eq, gte, inArray, lte, notInArray, sql, sum } from "drizzle-orm";
import {
  AlertCircle,
  ArrowRight,
  CalendarIcon,
  ClipboardIcon,
  FileTextIcon,
  Headphones,
  HeadphonesIcon,
  MailIcon,
  MessageSquareIcon,
  PhoneIcon,
  TargetIcon,
  TrendingUp,
  TrendingUpIcon,
  UsersIcon,
} from "lucide-react";
import { getTranslations } from "next-intl/server";

import { getAppointmentCalendarEvents } from "@/actions/appointments";
import { getLeads } from "@/actions/crm";
import { getDashboardStats, getRecentActivities, getTopDeals } from "@/actions/dashboard";
import { auth } from "@/auth";
import { TicketPriorityBadge } from "@/components/crm/ticket-priority-badge";
import { TicketStatusBadge } from "@/components/crm/ticket-status-badge";
import CRMCharts from "@/components/dashboard/CRMCharts.client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDb } from "@/lib/tenant-context";
import { activities, companies, contacts, deals, leads, salesTargets, tasks, tickets } from "@/db/schema";

import { type AgendaItem, AgendaWidget } from "./_components/agenda-widget";
import { MonthTargetCard } from "./_components/month-target-card";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ACTIVITY_ICON: Record<string, React.ReactNode> = {
  call: <PhoneIcon className="h-3.5 w-3.5 text-blue-500" />,
  email: <MailIcon className="h-3.5 w-3.5 text-violet-500" />,
  meeting: <CalendarIcon className="h-3.5 w-3.5 text-green-500" />,
  note: <ClipboardIcon className="h-3.5 w-3.5 text-amber-500" />,
};

function timeAgo(date: Date | null): string {
  if (!date) return "";
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m fa`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h fa`;
  return `${Math.floor(hrs / 24)}g fa`;
}

function greeting(hour: number, name: string) {
  const g = hour < 12 ? "Buongiorno" : hour < 18 ? "Buon pomeriggio" : "Buonasera";
  return `${g}, ${name}`;
}

function formatDueTime(d: Date | null) {
  if (!d) return null;
  return new Date(d).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
}

function formatToday(d: Date) {
  return d.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function CRMPage() {
  const db = await getDb();
  const t = await getTranslations("crm");
  const tc = await getTranslations("common");

  const session = await auth();
  const userId = session?.user?.id;
  const userName = session?.user?.name?.split(" ")[0] ?? "Utente";
  const role = session?.user?.role ?? "user";
  const isPrivileged = role === "admin" || role === "owner";

  const now = new Date();
  const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  // Limit overdue look-back to 30 days so stale tasks don't flood the agenda
  const thirtyDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30, 0, 0, 0);

  // ── All fetches in parallel ──────────────────────────────────────────────────
  // Agenda is always personal: filter by current user even for privileged roles.
  // Checks direct owner/assignee AND the multi-assignee table.
  const agendaTaskFilter = userId
    ? sql`(${tasks.ownerId} = ${userId} OR ${tasks.assigneeId} = ${userId} OR EXISTS (
        SELECT 1 FROM "task_assignee" WHERE task_id = ${tasks.id} AND user_id = ${userId}
      ))`
    : undefined;

  const [stats, rawLeads, topDeals, recentActivities, myTasks, todayActivities, todayAppointments, myTickets, myTarget, wonThisMonth] =
    await Promise.all([
      getDashboardStats(),
      getLeads(),
      getTopDeals(5),
      getRecentActivities(10),

      // Tasks due today or overdue, not done — with entity name joins
      userId
        ? db
            .select({
              id: tasks.id,
              title: tasks.title,
              dueDate: tasks.dueDate,
              startDate: tasks.startDate,
              allDay: tasks.allDay,
              status: tasks.status,
              priority: tasks.priority,
              estimatedHours: tasks.estimatedHours,
              ticketId: tasks.ticketId,
              leadId: tasks.leadId,
              contactId: tasks.contactId,
              companyId: tasks.companyId,
              dealId: tasks.dealId,
              leadFirstName: leads.firstName,
              leadLastName: leads.lastName,
              contactFirstName: contacts.firstName,
              contactLastName: contacts.lastName,
              companyName: companies.name,
              dealName: deals.name,
            })
            .from(tasks)
            .leftJoin(leads, eq(tasks.leadId, leads.id))
            .leftJoin(contacts, eq(tasks.contactId, contacts.id))
            .leftJoin(companies, eq(tasks.companyId, companies.id))
            .leftJoin(deals, eq(tasks.dealId, deals.id))
            .where(
              and(
                agendaTaskFilter as any,
                gte(tasks.dueDate, thirtyDaysAgo),
                lte(tasks.dueDate, todayEnd),
                notInArray(tasks.status, ["done"]),
              ),
            )
            .orderBy(tasks.dueDate)
        : Promise.resolve([]),

      // Today's meetings and calls with entity name joins
      userId
        ? db
            .select({
              id: activities.id,
              type: activities.type,
              content: activities.content,
              date: activities.date,
              durationMinutes: activities.durationMinutes,
              leadId: activities.leadId,
              contactId: activities.contactId,
              companyId: activities.companyId,
              dealId: activities.dealId,
              leadFirstName: leads.firstName,
              leadLastName: leads.lastName,
              contactFirstName: contacts.firstName,
              contactLastName: contacts.lastName,
              companyName: companies.name,
              dealName: deals.name,
            })
            .from(activities)
            .leftJoin(leads, eq(activities.leadId, leads.id))
            .leftJoin(contacts, eq(activities.contactId, contacts.id))
            .leftJoin(companies, eq(activities.companyId, companies.id))
            .leftJoin(deals, eq(activities.dealId, deals.id))
            .where(
              and(
                inArray(activities.type, ["meeting", "call"]),
                gte(activities.date, todayStart),
                lte(activities.date, todayEnd),
                !isPrivileged && userId ? eq(activities.ownerId, userId) : undefined,
              ) as any,
            )
            .orderBy(activities.date)
        : Promise.resolve([]),

      // Today's appointments (organizer or attendee)
      userId
        ? getAppointmentCalendarEvents([userId]).then((rows) =>
            rows.filter((r) => {
              const d = new Date(r.date);
              return d >= todayStart && d <= todayEnd && r.status !== "cancelled";
            }),
          )
        : Promise.resolve([]),

      // Open tickets assigned to me
      userId
        ? db
            .select({
              id: tickets.id,
              ticketNumber: tickets.ticketNumber,
              subject: tickets.subject,
              status: tickets.status,
              priority: tickets.priority,
              updatedAt: tickets.updatedAt,
              slaDeadlineAt: tickets.slaDeadlineAt,
            })
            .from(tickets)
            .where(
              and(
                isPrivileged ? undefined : sql`${tickets.assigneeId} = ${userId}`,
                notInArray(tickets.status, ["resolved", "closed"]),
              ) as any,
            )
            .orderBy(desc(tickets.updatedAt))
            .limit(8)
        : Promise.resolve([]),

      // Current month target for this user
      userId
        ? db.select({ targetAmount: salesTargets.targetAmount, currency: salesTargets.currency })
            .from(salesTargets)
            .where(and(eq(salesTargets.userId, userId), eq(salesTargets.period, currentPeriod)))
            .limit(1)
            .then((rows) => rows[0] ?? null)
        : Promise.resolve(null),

      // Won deals this month for this user
      userId
        ? db.select({ total: sum(deals.amount) })
            .from(deals)
            .where(and(eq(deals.status, "won"), eq(deals.ownerId, userId), gte(deals.updatedAt, monthStart)))
            .then((rows) => parseFloat(rows[0]?.total ?? "0"))
        : Promise.resolve(0 as number),
    ]);

  // ── Build agenda items ───────────────────────────────────────────────────────

  function entityNameFrom(row: {
    dealName: string | null;
    contactFirstName: string | null;
    contactLastName: string | null;
    leadFirstName: string | null;
    leadLastName: string | null;
    companyName: string | null;
  }): string | null {
    if (row.dealName) return row.dealName;
    if (row.contactFirstName) return `${row.contactFirstName} ${row.contactLastName ?? ""}`.trim();
    if (row.leadFirstName) return `${row.leadFirstName} ${row.leadLastName ?? ""}`.trim();
    return row.companyName ?? null;
  }

  function entityHrefFrom(row: {
    dealId: string | null;
    contactId: string | null;
    leadId: string | null;
    companyId: string | null;
  }): string | null {
    if (row.dealId) return "/dashboard/pipeline";
    if (row.contactId) return `/dashboard/contacts/${row.contactId}`;
    if (row.leadId) return `/dashboard/leads/${row.leadId}`;
    if (row.companyId) return `/dashboard/companies/${row.companyId}`;
    return null;
  }

  const agendaItems: AgendaItem[] = [
    ...myTasks.map((task): AgendaItem => {
      const isOverdue = task.dueDate ? new Date(task.dueDate) < todayStart : false;
      // Overdue timed tasks are moved to the flat all-day section to avoid
      // phantom time-grid placement at a past hour.
      const isAllDay = (task.allDay ?? true) || isOverdue;
      const entityHref = entityHrefFrom(task as any);
      return {
        id: task.id,
        kind: "task",
        title: task.title,
        allDay: isAllDay,
        timeISO: isAllDay
          ? (task.dueDate?.toISOString() ?? null)
          : ((task.startDate ?? task.dueDate)?.toISOString() ?? null),
        endTimeISO: isAllDay ? null : (task.dueDate?.toISOString() ?? null),
        priority: task.priority,
        status: task.status,
        entityName: entityNameFrom(task as any),
        entityHref,
        taskHref: task.ticketId ? `/dashboard/support/tickets/${task.ticketId}` : "/dashboard/tasks",
        durationMinutes: null,
        estimatedHours: task.estimatedHours ? String(task.estimatedHours) : null,
        isOverdue,
      };
    }),
    ...todayActivities.map((act): AgendaItem => {
      const entityHref = entityHrefFrom(act as any);
      const startMs = act.date ? new Date(act.date).getTime() : null;
      const endTimeISO =
        startMs && act.durationMinutes ? new Date(startMs + act.durationMinutes * 60_000).toISOString() : null;
      return {
        id: act.id,
        kind: act.type as "meeting" | "call",
        title: act.content ?? (act.type === "meeting" ? "Riunione" : "Chiamata"),
        allDay: false,
        timeISO: act.date ? act.date.toISOString() : null,
        endTimeISO,
        priority: "normal",
        status: "open",
        entityName: entityNameFrom(act as any),
        entityHref,
        taskHref: entityHref,
        durationMinutes: act.durationMinutes,
        estimatedHours: null,
        isOverdue: false,
      };
    }),
    ...todayAppointments.map(
      (appt): AgendaItem => ({
        id: appt.id,
        kind: "appointment",
        title: appt.displayTitle,
        allDay: false,
        timeISO: appt.date ? new Date(appt.date).toISOString() : null,
        endTimeISO: (appt as any).endAt ? new Date((appt as any).endAt).toISOString() : null,
        priority: "normal",
        status: appt.status,
        entityName: appt.entityName !== "No Entity" ? appt.entityName : null,
        entityHref: appt.link,
        taskHref: appt.link,
        durationMinutes: null,
        estimatedHours: null,
        isOverdue: false,
      }),
    ),
  ];

  const recentLeads = (rawLeads || [])
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  return (
    <div className="space-y-8 p-6">
      {/* ── Greeting + date ─────────────────────────────────────────── */}
      <div>
        <h1 className="font-bold text-3xl tracking-tight">{greeting(now.getHours(), userName)} 👋</h1>
        <p className="mt-0.5 text-muted-foreground capitalize">{formatToday(now)}</p>
      </div>

      {/* ── Agenda + Tickets ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <AgendaWidget items={agendaItems} dateLabel={formatToday(now)} />
        </div>

        {/* Tickets */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <Headphones className="h-4 w-4 text-muted-foreground" />
                Ticket assegnati
                {myTickets.length > 0 && (
                  <span className="rounded-full bg-muted px-2 py-0.5 font-normal text-muted-foreground text-xs">
                    {myTickets.length}
                  </span>
                )}
              </CardTitle>
              <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" asChild>
                <Link href="/dashboard/support/tickets">
                  Tutti <ArrowRight className="h-3 w-3" />
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-1 px-4 pb-4">
            {myTickets.length === 0 ? (
              <div className="flex flex-col items-center py-8 text-center">
                <Headphones className="mb-2 h-8 w-8 text-muted-foreground/20" />
                <p className="font-medium text-muted-foreground text-sm">Nessun ticket aperto</p>
              </div>
            ) : (
              myTickets.map((ticket) => {
                const slaUrgent =
                  ticket.slaDeadlineAt && new Date(ticket.slaDeadlineAt).getTime() - Date.now() < 3_600_000;
                return (
                  <Link
                    key={ticket.id}
                    href={`/dashboard/support/tickets/${ticket.id}`}
                    className="group flex items-start gap-3 rounded-lg p-2.5 transition-colors hover:bg-muted/60"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center gap-2">
                        <span className="shrink-0 font-mono text-muted-foreground text-xs">{ticket.ticketNumber}</span>
                        <TicketStatusBadge status={ticket.status} />
                        <TicketPriorityBadge priority={ticket.priority} />
                        {slaUrgent && (
                          <Badge variant="destructive" className="h-4 px-1.5 text-[10px]">
                            SLA
                          </Badge>
                        )}
                      </div>
                      <p className="truncate font-medium text-sm group-hover:text-primary">{ticket.subject}</p>
                      <p className="mt-0.5 text-muted-foreground text-xs">
                        aggiornato {timeAgo(ticket.updatedAt)}
                        {slaUrgent && ticket.slaDeadlineAt && (
                          <span className="ml-2 font-medium text-red-500">
                            · SLA scade {formatDueTime(ticket.slaDeadlineAt)}
                          </span>
                        )}
                      </p>
                    </div>
                    <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100" />
                  </Link>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Metric Cards ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Link href="/dashboard/pipeline" className="group">
          <Card className="cursor-pointer border-l-4 border-l-blue-500 shadow-sm transition-shadow group-hover:shadow-md">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="font-medium text-muted-foreground text-sm">{t("pipelineValue")}</CardTitle>
              <TrendingUpIcon className="h-4 w-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="font-bold text-2xl">€{stats.totalDealValue.toLocaleString()}</div>
              <p className="mt-1 text-muted-foreground text-xs">{t("pipelineValueDesc")}</p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/leads" className="group">
          <Card className="cursor-pointer border-l-4 border-l-green-500 shadow-sm transition-shadow group-hover:shadow-md">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="font-medium text-muted-foreground text-sm">{t("activeLeads")}</CardTitle>
              <UsersIcon className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="font-bold text-2xl">{stats.activeLeadsCount}</div>
              <p className="mt-1 text-muted-foreground text-xs">{t("activeLeadsDesc")}</p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/leads" className="group">
          <Card className="cursor-pointer border-l-4 border-l-orange-500 shadow-sm transition-shadow group-hover:shadow-md">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="font-medium text-muted-foreground text-sm">{t("conversionRate")}</CardTitle>
              <TargetIcon className="h-4 w-4 text-orange-500" />
            </CardHeader>
            <CardContent>
              <div className="font-bold text-2xl">{stats.conversionRate}%</div>
              <p className="mt-1 text-muted-foreground text-xs">{t("conversionRateDesc")}</p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/tasks" className="group">
          <Card className="cursor-pointer border-l-4 border-l-red-500 shadow-sm transition-shadow group-hover:shadow-md">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="font-medium text-muted-foreground text-sm">{t("pendingTasks")}</CardTitle>
              <AlertCircle className="h-4 w-4 text-red-500" />
            </CardHeader>
            <CardContent>
              <div className="font-bold text-2xl">{stats.todayTasks + stats.overdueTasks}</div>
              <div className="mt-1 flex gap-2">
                <span className="font-bold text-[10px] text-red-600 uppercase">
                  {t("overdueLabel", { count: stats.overdueTasks })}
                </span>
                <span className="text-[10px] text-muted-foreground uppercase">
                  {t("todayLabel", { count: stats.todayTasks })}
                </span>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/sales/quotes" className="group">
          <Card className="cursor-pointer border-l-4 border-l-violet-500 shadow-sm transition-shadow group-hover:shadow-md">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="font-medium text-muted-foreground text-sm">{t("quotesPipeline")}</CardTitle>
              <FileTextIcon className="h-4 w-4 text-violet-500" />
            </CardHeader>
            <CardContent>
              <div className="font-bold text-2xl">€{stats.quotesPipelineValue.toLocaleString()}</div>
              <div className="mt-1 flex gap-2">
                <span className="text-[10px] text-muted-foreground uppercase">
                  {t("openQuotesCount", { count: stats.quotesOpenCount })}
                </span>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/support/tickets" className="group">
          <Card className="cursor-pointer border-l-4 border-l-amber-500 shadow-sm transition-shadow group-hover:shadow-md">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="font-medium text-muted-foreground text-sm">{t("openTickets")}</CardTitle>
              <HeadphonesIcon className="h-4 w-4 text-amber-500" />
            </CardHeader>
            <CardContent>
              <div className="font-bold text-2xl">{stats.openTicketsCount}</div>
              <div className="mt-1 flex gap-2">
                {stats.urgentTicketsCount > 0 ? (
                  <span className="font-bold text-[10px] text-red-600 uppercase">
                    {t("urgentLabel", { count: stats.urgentTicketsCount })}
                  </span>
                ) : (
                  <span className="text-[10px] text-muted-foreground uppercase">{t("noUrgentTickets")}</span>
                )}
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* ── Target mensile ───────────────────────────────────────────── */}
      {(myTarget || wonThisMonth > 0) && <MonthTargetCard myTarget={myTarget} wonThisMonth={wonThisMonth} monthLabel={now.toLocaleDateString("it-IT", { month: "long", year: "numeric" })} />}

      {/* ── Charts ───────────────────────────────────────────────────── */}
      <CRMCharts dealDistribution={stats.dealDistribution} leadsBySource={stats.leadsBySource} />

      {/* ── Top Deals + Recent Activities ────────────────────────────── */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-blue-500" />
                {t("topDeals")}
              </CardTitle>
              <CardDescription>{t("highestValueOpportunities")}</CardDescription>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link href="/dashboard/pipeline">{t("viewPipeline")}</Link>
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {topDeals.length === 0 ? (
              <p className="py-8 text-center text-muted-foreground italic">{t("noOpenDeals")}</p>
            ) : (
              <div className="divide-y">
                {topDeals.map((deal) => (
                  <Link
                    key={deal.id}
                    href="/dashboard/pipeline"
                    className="flex items-center justify-between px-6 py-3 transition-colors hover:bg-muted/40"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-sm">{deal.name}</p>
                      <div className="mt-0.5 flex items-center gap-2">
                        {deal.stageName && (
                          <span
                            className="rounded-full px-1.5 py-0.5 font-semibold text-[10px] uppercase"
                            style={{ backgroundColor: `${deal.stageColor}22`, color: deal.stageColor ?? "#3b82f6" }}
                          >
                            {deal.stageName}
                          </span>
                        )}
                        {deal.companyName && (
                          <span className="truncate text-muted-foreground text-xs">{deal.companyName}</span>
                        )}
                      </div>
                    </div>
                    <div className="ml-4 shrink-0 text-right">
                      <p className="font-semibold text-sm">€{deal.amount.toLocaleString()}</p>
                      {deal.probability != null && (
                        <p className="text-[11px] text-muted-foreground">
                          {t("probPercent", { prob: deal.probability })}
                        </p>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquareIcon className="h-4 w-4 text-green-500" />
              {t("recentActivity")}
            </CardTitle>
            <CardDescription>{t("latestInteractions")}</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {recentActivities.length === 0 ? (
              <p className="py-8 text-center text-muted-foreground italic">{t("noActivitiesYet")}</p>
            ) : (
              <div className="divide-y">
                {recentActivities.map((act) => {
                  const entityName = act.contactFirstName
                    ? `${act.contactFirstName} ${act.contactLastName ?? ""}`.trim()
                    : (act.companyName ?? null);
                  return (
                    <div key={act.id} className="flex items-start gap-3 px-6 py-3">
                      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                        {ACTIVITY_ICON[act.type] ?? <ClipboardIcon className="h-3.5 w-3.5 text-muted-foreground" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-semibold text-xs capitalize">{act.type}</span>
                          {entityName && <span className="text-muted-foreground text-xs">— {entityName}</span>}
                        </div>
                        {act.content && (
                          <p className="mt-0.5 line-clamp-2 text-muted-foreground text-xs">{act.content}</p>
                        )}
                        <div className="mt-1 flex items-center gap-2">
                          {act.ownerName && <span className="text-[10px] text-muted-foreground">{act.ownerName}</span>}
                          <span className="text-[10px] text-muted-foreground">{timeAgo(act.createdAt)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Recent Leads ─────────────────────────────────────────────── */}
      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>{t("recentLeads")}</CardTitle>
            <CardDescription>{t("latestCustomers")}</CardDescription>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href="/dashboard/leads">{t("viewAll")}</Link>
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tc("name")}</TableHead>
                <TableHead>{tc("company")}</TableHead>
                <TableHead>{tc("status")}</TableHead>
                <TableHead>{tc("createdAt")}</TableHead>
                <TableHead className="text-right">{t("tableAction")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentLeads.map((lead) => (
                <TableRow key={lead.id} className="cursor-pointer hover:bg-muted/50">
                  <TableCell className="font-medium">
                    <Link href={`/dashboard/leads/${lead.id}`} className="hover:underline">
                      {lead.firstName} {lead.lastName}
                    </Link>
                  </TableCell>
                  <TableCell>{lead.companyName || "N/A"}</TableCell>
                  <TableCell>
                    <Badge variant={lead.status === "new" ? "default" : "secondary"} className="capitalize">
                      {lead.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {new Date(lead.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={`/dashboard/leads/${lead.id}`}>{t("viewAll")} →</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {recentLeads.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-4 text-center text-muted-foreground">
                    {t("noLeadsFound")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
