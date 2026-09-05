import Link from "next/link";

import { and, eq, gte, sum } from "drizzle-orm";
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
import { getLocale, getTranslations } from "next-intl/server";

import { getRecentLeads } from "@/actions/crm";
import { getDashboardStats, getRecentActivities, getTopDeals } from "@/actions/dashboard";
import { getNextActions } from "@/actions/next-actions";
import { getTodayView } from "@/actions/today";
import { TicketPriorityBadge } from "@/components/crm/ticket-priority-badge";
import { TicketStatusBadge } from "@/components/crm/ticket-status-badge";
import CRMCharts from "@/components/dashboard/CRMCharts.client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { deals, salesTargets } from "@/db/schema";
import { getActor } from "@/lib/auth-guard";
import { getDb } from "@/lib/tenant-context";

import { AgendaWidget } from "./_components/agenda-widget";
import { MonthTargetCard } from "./_components/month-target-card";
import { NextActionsCard } from "./_components/next-actions-card";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ACTIVITY_ICON: Record<string, React.ReactNode> = {
  call: <PhoneIcon className="h-3.5 w-3.5 text-blue-500" />,
  email: <MailIcon className="h-3.5 w-3.5 text-violet-500" />,
  meeting: <CalendarIcon className="h-3.5 w-3.5 text-green-500" />,
  note: <ClipboardIcon className="h-3.5 w-3.5 text-amber-500" />,
};

/**
 * Dates and times follow the reader's language.
 *
 * This screen formatted with `it-IT` hardcoded in three places, the forecast with
 * `en-US` and the email worker with `en-GB`, in a product that ships in two
 * languages (audit rilievo U-06). `Intl.RelativeTimeFormat` also removes three
 * hand-written Italian suffixes that no translation file knew about.
 */
function timeAgo(date: Date | null, locale: string): string {
  if (!date) return "";
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "narrow" });
  const mins = Math.floor((Date.now() - new Date(date).getTime()) / 60_000);
  if (mins < 60) return rtf.format(-mins, "minute");
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return rtf.format(-hrs, "hour");
  return rtf.format(-Math.floor(hrs / 24), "day");
}

function formatToday(d: Date, locale: string) {
  return d.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" });
}

// ─── Page ─────────────────────────────────────────────────────────────────────

/** How long is left before a ticket misses its promise, said the way a person would say it. */
function timeLeft(
  deadline: Date | null,
  t: Awaited<ReturnType<typeof getTranslations<"crm">>>,
): { text: string; late: boolean } | null {
  if (!deadline) return null;
  const ms = new Date(deadline).getTime() - Date.now();
  const late = ms < 0;

  const mins = Math.round(Math.abs(ms) / 60_000);
  if (mins < 60) return { text: t(late ? "minutesLate" : "minutesLeft", { n: mins }), late };
  const hours = Math.round(mins / 60);
  if (hours < 24) return { text: t(late ? "hoursLate" : "hoursLeft", { n: hours }), late };
  const days = Math.round(hours / 24);
  return { text: t(late ? "daysLate" : "daysLeft", { n: days }), late };
}

export default async function CRMPage() {
  const db = await getDb();
  const t = await getTranslations("crm");
  const tc = await getTranslations("common");

  const locale = await getLocale();
  const actor = await getActor();
  const userId = actor?.userId;
  const userName = actor?.name?.split(" ")[0] ?? tc("there");
  const now = new Date();
  const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const _todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const _todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  // Limit overdue look-back to 30 days so stale tasks don't flood the agenda
  const _thirtyDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30, 0, 0, 0);

  // ── All fetches in parallel ──────────────────────────────────────────────────

  const [stats, rawLeads, topDeals, recentActivities, myTarget, wonThisMonth, nextActions, today] = await Promise.all([
    getDashboardStats(),
    getRecentLeads(5),
    getTopDeals(5),
    getRecentActivities(10),

    // Current month target for this user
    userId
      ? db
          .select({ targetAmount: salesTargets.targetAmount, currency: salesTargets.currency })
          .from(salesTargets)
          .where(and(eq(salesTargets.userId, userId), eq(salesTargets.period, currentPeriod)))
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),

    // Won deals this month for this user
    userId
      ? db
          .select({ total: sum(deals.amount) })
          .from(deals)
          .where(and(eq(deals.status, "won"), eq(deals.ownerId, userId), gte(deals.updatedAt, monthStart)))
          .then((rows) => parseFloat(rows[0]?.total ?? "0"))
      : Promise.resolve(0 as number),

    // What needs doing, rather than what exists (audit rilievo S-02). Failing to
    // build the work list must not take the whole dashboard down with it: an
    // empty list reads as "nothing waiting", which is the safe way to be wrong.
    getNextActions(8).catch(() => null),

    // The day's agenda. This page used to assemble it from three queries of its
    // own and a hundred and thirty lines of mapping; the "today" screen needs the
    // same list, and two copies of it would have drifted apart within a month.
    getTodayView(),
  ]);

  const agendaItems = today.agenda;

  // The same list the page used to fetch for itself, ordered by when each ticket
  // stops being on time rather than by when it was last touched — which is the
  // order somebody works them in.
  const myTickets = today.tickets;

  // ── Build agenda items ───────────────────────────────────────────────────────

  // Already the five most recent, ordered by the database. This used to load every
  // lead in the workspace, sort them in JavaScript and throw all but five away
  // (audit rilievo B-08).
  const recentLeads = rawLeads;

  return (
    <div className="space-y-8 p-6">
      {/* ── Greeting + date ─────────────────────────────────────────── */}
      <div>
        <h1 className="font-bold text-3xl tracking-tight">
          {t(now.getHours() < 12 ? "greetingMorning" : now.getHours() < 18 ? "greetingAfternoon" : "greetingEvening", {
            name: userName,
          })}{" "}
          👋
        </h1>
        <p className="mt-0.5 text-muted-foreground capitalize">{formatToday(now, locale)}</p>
      </div>

      {/* ── What needs doing ─────────────────────────────────────────── */}
      {/*
        Above everything else on purpose. The cards below say what exists; this
        one says what to do about it, which is the question the screen is opened
        with (audit rilievo S-02).
      */}
      <NextActionsCard actions={nextActions ?? []} failed={nextActions === null} />

      {/* ── Agenda + Tickets ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <AgendaWidget items={agendaItems} dateLabel={formatToday(now, locale)} />
        </div>

        {/* Tickets */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <Headphones className="h-4 w-4 text-muted-foreground" />
                {t("assignedTickets")}
                {myTickets.length > 0 && (
                  <span className="rounded-full bg-muted px-2 py-0.5 font-normal text-muted-foreground text-xs">
                    {myTickets.length}
                  </span>
                )}
              </CardTitle>
              <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" asChild>
                <Link href="/dashboard/support/tickets">
                  {tc("all")} <ArrowRight className="h-3 w-3" />
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-1 px-4 pb-4">
            {myTickets.length === 0 ? (
              <div className="flex flex-col items-center py-8 text-center">
                <Headphones className="mb-2 h-8 w-8 text-muted-foreground/20" />
                <p className="font-medium text-muted-foreground text-sm">{t("noOpenTickets")}</p>
              </div>
            ) : (
              myTickets.map((ticket) => {
                // How long is left, said the way a person would say it. The card
                // used to show this only inside the last hour, which is the point
                // at which knowing is no longer much use.
                const left = timeLeft(ticket.slaDeadlineAt, t);
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
                        {left?.late && (
                          <Badge variant="destructive" className="h-4 px-1.5 text-[10px]">
                            SLA
                          </Badge>
                        )}
                      </div>
                      <p className="truncate font-medium text-sm group-hover:text-primary">{ticket.subject}</p>
                      <p className="mt-0.5 text-muted-foreground text-xs">
                        {t("updatedAgo", { time: timeAgo(ticket.updatedAt, locale) })}
                        {left && (
                          <span className={left.late ? "ml-2 font-medium text-red-500" : "ml-2"}>· {left.text}</span>
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
      {(myTarget || wonThisMonth > 0) && (
        <MonthTargetCard
          myTarget={myTarget}
          wonThisMonth={wonThisMonth}
          monthLabel={now.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        />
      )}

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
                          <span className="text-[10px] text-muted-foreground">{timeAgo(act.createdAt, locale)}</span>
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
