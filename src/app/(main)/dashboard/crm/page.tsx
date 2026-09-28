import Link from "next/link";
import { after } from "next/server";

import { and, count, eq, inArray, isNull, or, sum } from "drizzle-orm";
import {
  AlertCircle,
  ArrowRight,
  CalendarDaysIcon,
  CalendarIcon,
  CalendarX2Icon,
  ClipboardIcon,
  FileTextIcon,
  Headphones,
  HeadphonesIcon,
  MailIcon,
  MessageSquareIcon,
  PhoneIcon,
  RepeatIcon,
  ScrollTextIcon,
  TargetIcon,
  TrendingUp,
  TrendingUpIcon,
  TrophyIcon,
  UsersIcon,
} from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";

import { getRecurringRevenueSummary } from "@/actions/contracts";
import { getRecentLeads } from "@/actions/crm";
import { getDashboardStats, getRecentActivities, getTopDeals } from "@/actions/dashboard";
import { getNextActions } from "@/actions/next-actions";
import { getOnboarding } from "@/actions/onboarding";
import { getHomeDashboardSetting } from "@/actions/preferences";
import { getTodayView } from "@/actions/today";
import { Money } from "@/components/crm/money";
import { TicketPriorityBadge } from "@/components/crm/ticket-priority-badge";
import { TicketStatusBadge } from "@/components/crm/ticket-status-badge";
// Loaded after the page: the chart library is the heaviest thing on this screen
// and the two charts sit below everything people open it to read.
import CRMCharts from "@/components/dashboard/crm-charts-lazy";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { deals, leads, salesTargets } from "@/db/schema";
import { getActor } from "@/lib/auth-guard";
import { getEntitlements } from "@/lib/billing/licensing";
import type { PlanModule } from "@/lib/billing/plans-config";
import { countOpenDealsWithoutNextStep } from "@/lib/deal-signals";
import { encodeFilter, type FilterNode } from "@/lib/filter-types";
import { resolveHomeDashboard } from "@/lib/home-dashboards";
import { closedBetween } from "@/lib/metrics";
import { rememberLocale } from "@/lib/morning-digest";
import { showOnboarding } from "@/lib/onboarding";
import { can } from "@/lib/permissions";
import { getCurrentTenantId, getDb } from "@/lib/tenant-context";
import { timeLeft } from "@/lib/time-left";
import { toWallDate } from "@/lib/wall-clock";
import { monthStart as workspaceMonthStart } from "@/lib/workspace-day";
import { getWorkspaceTimeZone } from "@/lib/workspace-time-zone";

import { AgendaWidget } from "./_components/agenda-widget";
import { DashboardSwitcher } from "./_components/dashboard-switcher";
import { DeskDashboard } from "./_components/desk-dashboard";
import { KPI_VALUE, Kpi } from "./_components/kpi";
import { ManagerDashboard } from "./_components/manager-dashboard";
import { MoneyDashboard } from "./_components/money-dashboard";
import { NextActionsCard } from "./_components/next-actions-card";
import { OnboardingCard } from "./_components/onboarding-card";

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

/** An active lead: new or being contacted — the company's count and the personal one alike. */
const ACTIVE_LEAD_STATUSES = ["new", "contacting"];
const ACTIVE_LEAD = inArray(leads.status, ACTIVE_LEAD_STATUSES);

/**
 * The leads list, filtered to what the figure counts: the active leads — and with a person,
 * only theirs or nobody's ("Leads to work"). A figure that cannot be opened cannot be checked.
 */
function activeLeadsHref(userId?: string): string {
  const conditions: FilterNode[] = [
    { id: "status", type: "condition", field: "status", operator: "in", value: ACTIVE_LEAD_STATUSES },
  ];
  if (userId) {
    conditions.push({
      id: "owner",
      type: "group",
      logic: "OR",
      conditions: [
        { id: "mine", type: "condition", field: "ownerId", operator: "in", value: [userId] },
        { id: "nobody", type: "condition", field: "ownerId", operator: "is_empty", value: null },
      ],
    });
  }
  return `/dashboard/leads?filter=${encodeURIComponent(encodeFilter({ version: 1, logic: "AND", conditions }))}`;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function CRMPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const db = await getDb();
  const t = await getTranslations("crm");
  const tc = await getTranslations("common");

  const locale = await getLocale();
  const actor = await getActor();
  const userId = actor?.userId;
  const params = await searchParams;
  // Which dashboard (src/lib/home-dashboards.ts): the address wins, then the person's own
  // choice in their Profile, then the role. A setting that cannot be read is no choice
  // made — the default for the role — never a home page that does not load.
  const setting = await getHomeDashboardSetting().catch(() => null);
  const dashboard = resolveHomeDashboard(
    { fromUrl: params.dashboard ?? params.view, saved: setting?.saved },
    setting?.access ?? {
      readsReports: false,
      managesSettings: false,
      managesEveryRecord: can(actor, "record:manageAny"),
      hasSales: false,
      hasSupport: false,
    },
  );
  // Commerciale and Direzione are the two halves this page has always had, never mixed on
  // one screen (§3.4): "me" — the day's numbers, the work list and the agenda, all this
  // person's — and "company", the state of the business.
  const view = dashboard === "direction" ? "company" : "me";
  const userName = actor?.name?.split(" ")[0] ?? tc("there");
  const now = new Date();
  // The month on the workspace's clock: a deal won at 00:30 on the first, Rome time, is
  // this month's — on the server's UTC clock it was still last month's.
  const timeZone = await getWorkspaceTimeZone();
  const currentPeriod = toWallDate(now, timeZone).slice(0, 7);
  const monthStart = workspaceMonthStart(now, timeZone);

  const header = (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-bold text-2xl tracking-tight sm:text-3xl">
          {t(now.getHours() < 12 ? "greetingMorning" : now.getHours() < 18 ? "greetingAfternoon" : "greetingEvening", {
            name: userName,
          })}{" "}
          👋
        </h1>
        <p className="mt-0.5 text-muted-foreground capitalize">{formatToday(now, locale)}</p>
      </div>
      <DashboardSwitcher current={dashboard} available={setting?.available ?? ["sales", "direction"]} />
    </div>
  );

  // The language of the morning digest is the one this person reads the product in; an
  // email at six has no request to learn it from. After the response, and one statement.
  if (userId) {
    after(() => rememberLocale(db, userId, locale).catch(() => undefined));
  }

  // ⚠️ The other three dashboards (team, money, desk) read only their own figures: the personal and company
  // reads below would be paid for and thrown away (src/lib/home-dashboard-data.ts).
  if (dashboard === "salesManager" || dashboard === "admin" || dashboard === "support") {
    return (
      <div className="flex flex-col gap-6 md:gap-8">
        {header}
        {dashboard === "salesManager" ? (
          <ManagerDashboard />
        ) : dashboard === "admin" ? (
          <MoneyDashboard />
        ) : (
          <DeskDashboard />
        )}
      </div>
    );
  }

  // ── All fetches in parallel ──────────────────────────────────────────────────

  // The company's figures are a dozen statements; they are read only when that half is shown.
  // Every home visit used to pay for them and then throw them away on "me".
  const companyData =
    view === "company"
      ? Promise.all([
          getDashboardStats(),
          getRecentLeads(5),
          getTopDeals(5),
          getRecentActivities(10),
          // Contracts are optional; a failure here reads as none rather than taking the page down.
          getRecurringRevenueSummary().catch(() => ({ mrr: [], earning: 0, renewalsDue: 0 })),
        ])
      : null;

  // The four numbers of one's own are Commerciale's; Direzione does not read them, and
  // the month-target card that showed one's own target on the business's page is gone.
  const mine = view === "me" ? userId : undefined;
  const [myTarget, wonThisMonth, myLeads, nextActions, today, onboarding, bareDeals, modules] = await Promise.all([
    // Current month target for this user
    mine
      ? db
          .select({ targetAmount: salesTargets.targetAmount, currency: salesTargets.currency })
          .from(salesTargets)
          .where(and(eq(salesTargets.userId, mine), eq(salesTargets.period, currentPeriod)))
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),

    // Won deals this month for this user
    mine
      ? db
          .select({ total: sum(deals.amount) })
          .from(deals)
          // Dated by when it closed: `updatedAt` moved an old win into this month on any re-save.
          .where(and(closedBetween("won", monthStart), eq(deals.ownerId, mine)))
          .then((rows) => parseFloat(rows[0]?.total ?? "0"))
      : Promise.resolve(0 as number),

    // The leads this person should be working: new or being contacted, theirs or nobody's
    // yet. An unassigned lead is everybody's queue, so it counts for everybody.
    mine
      ? db
          .select({ n: count() })
          .from(leads)
          .where(and(ACTIVE_LEAD, or(eq(leads.ownerId, mine), isNull(leads.ownerId))))
          .then((rows) => Number(rows[0]?.n ?? 0))
          .catch(() => 0)
      : Promise.resolve(0),

    // What needs doing, rather than what exists (audit rilievo S-02). Failing to
    // build the work list must not take the whole dashboard down with it: an
    // empty list reads as "nothing waiting", which is the safe way to be wrong.
    getNextActions(8).catch(() => null),

    // The day's agenda. This page used to assemble it from three queries of its
    // own and a hundred and thirty lines of mapping; the "today" screen needs the
    // same list, and two copies of it would have drifted apart within a month.
    getTodayView(),

    // The first-run steps, for whoever manages the workspace. Never the reason the page fails.
    getOnboarding().catch(() => null),

    // The first of the three numbers of one's own. Never the reason the page fails.
    mine ? countOpenDealsWithoutNextStep(db, mine).catch(() => 0) : Promise.resolve(0),

    // Cards for a module the plan does not include are left out, as in the menu.
    getCurrentTenantId().then((tenantId) =>
      tenantId
        ? getEntitlements(tenantId).then(
            (e) => e.enabledModules,
            () => undefined,
          )
        : undefined,
    ),
  ]);

  const agendaItems = today.agenda;
  // Started before the personal reads, so the two run side by side; absent on "me".
  const [stats, rawLeads, topDeals, recentActivities, recurring] = (companyData ? await companyData : []) as
    | Awaited<NonNullable<typeof companyData>>
    | [];

  const inPlan = (module: PlanModule) => !modules || modules.includes(module);

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
    /*
      ⚠️ Below `md` the sections are reordered with `order`, not moved in the
      markup. On a phone this is the first screen after login and it is read top
      to bottom, one card at a time: today's agenda, then the numbers, then the
      work list and the tickets. On a desktop the work list sits first because
      the agenda and the figures are visible beside and under it at a glance.
      The agenda/tickets grid is `display: contents` below `md` so its two
      children can take part in the ordering on their own.
    */
    <div className="flex flex-col gap-6 md:gap-8">
      {header}

      {/* ── Direzione: the state of the business comes first ──────────── */}
      {/* ⚠️ Not the four personal numbers below with the company's under them: the
          person who opens this dashboard opens it for the business, and a first row
          of their own won deals read as the company's (§3.4). Two across on a phone:
          each card is a label and a number, and one per row made the dashboard six
          screens long before the first chart. */}
      {view === "company" && stats && recurring && (
        <div className="grid grid-cols-2 gap-3 md:gap-6 lg:grid-cols-4">
          <Kpi
            // Everybody's open deals, which is what it sums: the board alone opens on one's own.
            href="/dashboard/pipeline?owners=all&status=open&pipeline=all"
            accent="border-l-blue-500"
            title={t("pipelineValue")}
            icon={<TrendingUpIcon className="h-4 w-4 shrink-0 text-blue-500" />}
          >
            <div className={KPI_VALUE}>
              <Money value={stats.totalDealValue} />
            </div>
            <p className="mt-1 text-muted-foreground text-xs">{t("pipelineValueDesc")}</p>
          </Kpi>
          <Kpi
            href={activeLeadsHref()}
            accent="border-l-green-500"
            title={t("activeLeads")}
            icon={<UsersIcon className="h-4 w-4 shrink-0 text-green-500" />}
          >
            <div className={KPI_VALUE}>{stats.activeLeadsCount}</div>
            <p className="mt-1 text-muted-foreground text-xs">{t("activeLeadsDesc")}</p>
          </Kpi>
          <Kpi
            href="/dashboard/leads"
            accent="border-l-orange-500"
            title={t("conversionRate")}
            icon={<TargetIcon className="h-4 w-4 shrink-0 text-orange-500" />}
          >
            <div className={KPI_VALUE}>
              {/* In the reader's number format: "0.0%" is an English decimal on an Italian page. */}
              {new Intl.NumberFormat(locale === "it" ? "it-IT" : "en-GB", {
                style: "percent",
                maximumFractionDigits: 1,
              }).format(Number(stats.conversionRate) / 100)}
            </div>
            <p className="mt-1 text-muted-foreground text-xs">{t("conversionRateDesc")}</p>
          </Kpi>
          <Kpi
            href="/dashboard/tasks"
            accent="border-l-red-500"
            title={t("pendingTasks")}
            icon={<AlertCircle className="h-4 w-4 shrink-0 text-red-500" />}
          >
            <div className={KPI_VALUE}>{stats.todayTasks + stats.overdueTasks}</div>
            <div className="mt-1 flex flex-wrap gap-x-2">
              <span className="font-bold text-[10px] text-red-600 uppercase">
                {t("overdueLabel", { count: stats.overdueTasks })}
              </span>
              <span className="text-[10px] text-muted-foreground uppercase">
                {t("todayLabel", { count: stats.todayTasks })}
              </span>
            </div>
          </Kpi>
          {inPlan("sales") && (
            <>
              <Kpi
                href="/dashboard/sales/quotes?status=awaiting"
                accent="border-l-violet-500"
                title={t("quotesPipeline")}
                icon={<FileTextIcon className="h-4 w-4 shrink-0 text-violet-500" />}
              >
                <div className={KPI_VALUE}>
                  <Money value={stats.quotesPipelineValue} />
                </div>
                <div className="mt-1 flex flex-wrap gap-x-2">
                  <span className="text-[10px] text-muted-foreground uppercase">
                    {t("openQuotesCount", { count: stats.quotesOpenCount })}
                  </span>
                </div>
              </Kpi>
              <Kpi
                href="/dashboard/sales/contracts"
                accent="border-l-emerald-500"
                title={t("contracts_mrr")}
                icon={<RepeatIcon className="h-4 w-4 shrink-0 text-emerald-500" />}
              >
                <div className={KPI_VALUE}>
                  {(recurring.mrr.length ? recurring.mrr : [{ currency: "EUR", amount: 0 }])
                    .map((m) =>
                      new Intl.NumberFormat(locale === "it" ? "it-IT" : "en-GB", {
                        style: "currency",
                        currency: m.currency,
                        maximumFractionDigits: 0,
                        useGrouping: "always",
                      }).format(m.amount),
                    )
                    .join(" · ")}
                </div>
                <p className="mt-1 text-muted-foreground text-xs">{t("contracts_mrrDesc")}</p>
              </Kpi>
              <Kpi
                href="/dashboard/sales/contracts?view=renewal_due"
                accent="border-l-yellow-500"
                title={t("contracts_renewalsDue")}
                icon={<ScrollTextIcon className="h-4 w-4 shrink-0 text-yellow-500" />}
              >
                <div className={KPI_VALUE}>{recurring.renewalsDue}</div>
                <p className="mt-1 text-muted-foreground text-xs">{t("contracts_renewalsDueDesc")}</p>
              </Kpi>
            </>
          )}
          {inPlan("support") && (
            <Kpi
              href="/dashboard/support/tickets"
              accent="border-l-amber-500"
              title={t("openTickets")}
              icon={<HeadphonesIcon className="h-4 w-4 shrink-0 text-amber-500" />}
            >
              <div className={KPI_VALUE}>{stats.openTicketsCount}</div>
              <div className="mt-1 flex flex-wrap gap-x-2">
                {stats.urgentTicketsCount > 0 ? (
                  <span className="font-bold text-[10px] text-red-600 uppercase">
                    {t("urgentLabel", { count: stats.urgentTicketsCount })}
                  </span>
                ) : (
                  <span className="text-[10px] text-muted-foreground uppercase">{t("noUrgentTickets")}</span>
                )}
              </div>
            </Kpi>
          )}
        </div>
      )}

      {/* ── Commerciale: four numbers of one's own ─────────────────────── */}
      {view === "me" && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi
            // The deals it adds up: mine, won, closed this month on the workspace's clock.
            href={
              userId
                ? `/dashboard/pipeline?owners=${userId}&status=won&closed=${currentPeriod}&pipeline=all`
                : "/dashboard/pipeline/targets"
            }
            accent="border-l-emerald-500"
            title={t("myWon")}
            icon={<TrophyIcon className="h-4 w-4 shrink-0 text-emerald-500" />}
          >
            <div className={KPI_VALUE}>
              <Money value={wonThisMonth} />
            </div>
            <p className="mt-1 text-muted-foreground text-xs">
              {myTarget ? (
                <>
                  {t("myWonOf")} <Money value={Number(myTarget.targetAmount)} />
                </>
              ) : (
                t("myWonNoTarget")
              )}
            </p>
          </Kpi>
          <Kpi
            href={userId ? `/dashboard/pipeline?owners=${userId}` : "/dashboard/pipeline"}
            accent={bareDeals > 0 ? "border-l-red-500" : "border-l-slate-300"}
            title={t("myBareDeals")}
            icon={
              <CalendarX2Icon
                className={`h-4 w-4 shrink-0 ${bareDeals > 0 ? "text-red-500" : "text-muted-foreground"}`}
              />
            }
          >
            <div className={KPI_VALUE}>{bareDeals}</div>
            <p className="mt-1 text-muted-foreground text-xs">{t("myBareDealsDesc")}</p>
          </Kpi>
          <Kpi
            href="/dashboard/calendar"
            accent="border-l-blue-500"
            title={t("myToday")}
            icon={<CalendarDaysIcon className="h-4 w-4 shrink-0 text-blue-500" />}
          >
            <div className={KPI_VALUE}>{agendaItems.length}</div>
            <p className="mt-1 text-muted-foreground text-xs">{t("myTodayDesc")}</p>
          </Kpi>
          <Kpi
            href={activeLeadsHref(userId)}
            accent="border-l-violet-500"
            title={t("myLeads")}
            icon={<UsersIcon className="h-4 w-4 shrink-0 text-violet-500" />}
          >
            <div className={KPI_VALUE}>{myLeads}</div>
            <p className="mt-1 text-muted-foreground text-xs">{t("myLeadsDesc")}</p>
          </Kpi>
        </div>
      )}

      {/* ── What needs doing ─────────────────────────────────────────── */}
      {/*
        Above everything else on purpose. The cards below say what exists; this
        one says what to do about it, which is the question the screen is opened
        with (audit rilievo S-02).
      */}
      {onboarding && showOnboarding(onboarding) && (
        <div className="max-md:order-first">
          <OnboardingCard state={onboarding} />
        </div>
      )}

      <div className="max-md:order-3">
        <NextActionsCard
          actions={nextActions ?? []}
          failed={nextActions === null}
          canWrite={can(actor, "record:write")}
        />
      </div>

      {/* ── Agenda + Tickets ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-5 max-md:contents xl:grid-cols-3">
        <div className={`min-w-0 max-md:order-1 ${inPlan("support") ? "xl:col-span-2" : "xl:col-span-3"}`}>
          <AgendaWidget items={agendaItems} dateLabel={formatToday(now, locale)} />
        </div>

        {/* Tickets, when the plan has support */}
        {inPlan("support") && (
          <Card className="max-md:order-4">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="flex min-w-0 items-center gap-2 text-base">
                  <Headphones className="h-4 w-4 text-muted-foreground" />
                  {/* The list is the whole queue for whoever can see every user (src/actions/today.ts),
                      and was titled "assigned" all the same: unassigned tickets under that name. */}
                  {can(actor, "user:read") ? t("ticketQueue") : t("assignedTickets")}
                  {myTickets.length > 0 && (
                    <span className="rounded-full bg-muted px-2 py-0.5 font-normal text-muted-foreground text-xs">
                      {myTickets.length}
                    </span>
                  )}
                </CardTitle>
                <Button variant="ghost" size="sm" className="h-7 shrink-0 gap-1 text-xs" asChild>
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
                  const left = timeLeft(ticket.slaDeadlineAt, tc);
                  return (
                    <Link
                      key={ticket.id}
                      href={`/dashboard/support/tickets/${ticket.id}`}
                      className="group flex items-start gap-3 rounded-lg p-2.5 transition-colors hover:bg-muted/60"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="shrink-0 font-mono text-muted-foreground text-xs">
                            {ticket.ticketNumber}
                          </span>
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
        )}
      </div>

      {view === "company" && stats && recurring && topDeals && recentActivities && recentLeads && (
        <>
          {/* ── Charts ───────────────────────────────────────────────────── */}
          <div className="min-w-0 max-md:order-5">
            <CRMCharts dealDistribution={stats.dealDistribution} leadsBySource={stats.leadsBySource} />
          </div>

          {/* ── Top Deals + Recent Activities ────────────────────────────── */}
          <div className="grid grid-cols-1 gap-6 max-md:order-5 md:gap-8 lg:grid-cols-2">
            <Card className="shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-blue-500" />
                    {t("topDeals")}
                  </CardTitle>
                  <CardDescription>{t("highestValueOpportunities")}</CardDescription>
                </div>
                <Button variant="outline" size="sm" className="shrink-0" asChild>
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
                        href={`/dashboard/pipeline/${deal.id}`}
                        className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-muted/40 sm:px-6"
                      >
                        <div className="min-w-0 flex-1">
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
                          <p className="font-semibold text-sm">
                            <Money value={deal.amount} />
                          </p>
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
                        <div key={act.id} className="flex items-start gap-3 px-4 py-3 sm:px-6">
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
                              {act.ownerName && (
                                <span className="text-[10px] text-muted-foreground">{act.ownerName}</span>
                              )}
                              <span className="text-[10px] text-muted-foreground">
                                {timeAgo(act.createdAt, locale)}
                              </span>
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
          <Card className="shadow-sm max-md:order-5">
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <div className="min-w-0">
                <CardTitle>{t("recentLeads")}</CardTitle>
                <CardDescription>{t("latestCustomers")}</CardDescription>
              </div>
              <Button variant="outline" size="sm" className="shrink-0" asChild>
                <Link href="/dashboard/leads">{t("viewAll")}</Link>
              </Button>
            </CardHeader>
            <CardContent>
              {/* Five columns do not fit a phone; below `md` each lead is one tappable row. */}
              <ul className="divide-y md:hidden">
                {recentLeads.map((lead) => (
                  <li key={lead.id}>
                    <Link
                      href={`/dashboard/leads/${lead.id}`}
                      className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-muted/50"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-sm">
                          {lead.firstName} {lead.lastName}
                        </p>
                        <p className="truncate text-muted-foreground text-xs">
                          {lead.companyName || "N/A"} · {new Date(lead.createdAt).toLocaleDateString(locale)}
                        </p>
                      </div>
                      <Badge variant={lead.status === "new" ? "default" : "secondary"} className="shrink-0 capitalize">
                        {lead.status}
                      </Badge>
                    </Link>
                  </li>
                ))}
                {recentLeads.length === 0 && (
                  <li className="py-4 text-center text-muted-foreground text-sm">{t("noLeadsFound")}</li>
                )}
              </ul>
              <Table className="hidden md:table">
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
                        {new Date(lead.createdAt).toLocaleDateString(locale)}
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
        </>
      )}
    </div>
  );
}
