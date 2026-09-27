"use client";

import { useCallback, useState, useTransition } from "react";

import { format, subDays } from "date-fns";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  DollarSign,
  Download,
  FileText,
  Medal,
  RefreshCw,
  ShoppingCart,
  Target,
  Ticket,
  TrendingUp,
  Users,
} from "lucide-react";
import { useTranslations } from "next-intl";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";

import {
  getActivityByAction,
  getActivityByUser,
  getDailyActivityTrend,
  getReportKPIs,
  getSalesReport,
  getTaskPerformanceByUser,
} from "@/actions/reports";
import { RecordCards, ResponsiveRecordList } from "@/components/crm/record-cards";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCurrency } from "@/hooks/use-currency";
import { useIsMobile } from "@/hooks/use-mobile";

// ─── Types ─────────────────────────────────────────────────────────────────────
type User = { id: string; name: string | null; email: string | null; role: string };

type KPIs = Awaited<ReturnType<typeof getReportKPIs>>;
type ActivityByUser = Awaited<ReturnType<typeof getActivityByUser>>;
type ActivityByAction = Awaited<ReturnType<typeof getActivityByAction>>;
type DailyTrend = Awaited<ReturnType<typeof getDailyActivityTrend>>;
type TaskPerf = Awaited<ReturnType<typeof getTaskPerformanceByUser>>;
type SalesReport = Awaited<ReturnType<typeof getSalesReport>>;

interface InitialData {
  kpis: KPIs;
  activityByUser: ActivityByUser;
  activityByAction: ActivityByAction;
  dailyTrend: DailyTrend;
  taskPerf: TaskPerf;
  salesReport: SalesReport;
}

interface Props {
  users: User[];
  initial: InitialData;
}

// ─── Constants ─────────────────────────────────────────────────────────────────
const CHART_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899"];

// ─── Helpers ───────────────────────────────────────────────────────────────────
function StatCard({
  title,
  value,
  sub,
  icon: Icon,
  color,
  trend,
  trendLabel,
}: {
  title: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  color: string;
  trend?: number;
  trendLabel?: string;
}) {
  return (
    // Tighter below `sm`, where these sit two to a row with ~120px of content each.
    <Card className={`gap-3 border-l-4 py-4 shadow-sm sm:gap-6 sm:py-6 ${color}`}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 px-4 pb-2 sm:px-6">
        <CardTitle className="min-w-0 text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      </CardHeader>
      <CardContent className="px-4 sm:px-6">
        <div className="break-words text-xl font-bold tabular-nums sm:text-2xl">{value}</div>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
        {trend !== undefined && trendLabel && (
          <div className={`text-xs font-medium mt-1 ${trend >= 0 ? "text-green-600" : "text-red-600"}`}>
            {trend >= 0 ? "▲" : "▼"} {trendLabel}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EmptyChart({ label }: { label: string }) {
  return <div className="flex items-center justify-center h-[220px] text-muted-foreground text-sm">{label}</div>;
}

// ─── Main Component ────────────────────────────────────────────────────────────
export function ReportsClient({ users, initial }: Props) {
  const t = useTranslations("reports");
  // Workspace totals are EUR at rest; this shows them in the viewer's display currency.
  const { formatAmount } = useCurrency();
  // The "actions" of this tab are activity types now — the calls, meetings, emails and notes
  // people log — so they are named as the activity form names them.
  const tTypes = useTranslations("activityModal.types");
  const actionLabels: Record<string, string> = {
    call: tTypes("call"),
    meeting: tTypes("meeting"),
    email: tTypes("email"),
    note: tTypes("note"),
  };
  const defaultFrom = format(subDays(new Date(), 29), "yyyy-MM-dd");
  const defaultTo = format(new Date(), "yyyy-MM-dd");

  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [userId, setUserId] = useState("all");
  const [data, setData] = useState(initial);
  const [isPending, startTransition] = useTransition();
  // Chart geometry that has to be a number, not a class: axis widths and pie labels.
  const isMobile = useIsMobile();

  const refresh = useCallback(() => {
    startTransition(async () => {
      try {
        const filters = {
          from,
          to,
          userId: userId === "all" ? undefined : userId,
        };
        const [kpis, activityByUser, activityByAction, dailyTrend, taskPerf, salesReport] = await Promise.all([
          getReportKPIs(filters),
          getActivityByUser(filters),
          getActivityByAction(filters),
          getDailyActivityTrend(filters),
          getTaskPerformanceByUser(filters),
          getSalesReport(filters),
        ]);
        setData({ kpis, activityByUser, activityByAction, dailyTrend, taskPerf, salesReport });
      } catch {
        toast.error(t("refreshFailed"));
      }
    });
  }, [from, to, userId, t]);

  const handleExport = () => {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (userId !== "all") params.set("userId", userId);
    window.open(`/api/reports/export?${params}`, "_blank");
  };

  const { kpis, activityByUser, activityByAction, dailyTrend, taskPerf, salesReport } = data;
  const noDataLabel = t("noData");

  return (
    <div className="space-y-6">
      {/* Filter bar */}
      <Card className="border-0 shadow-sm">
        {/* One column on a phone, every control full width. As a wrapping flex
            row each kept its desktop width (144, 144, 176px) and sat alone on a
            line with the rest of it empty; two dates across would be 142px
            each, too narrow for the picker the browser draws inside them. */}
        <CardContent className="px-4 pt-4 pb-4 sm:px-6">
          <div className="grid grid-cols-1 gap-3 sm:flex sm:flex-wrap sm:items-end sm:gap-4">
            <div className="min-w-0 space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">{t("from")}</Label>
              <Input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="h-8 w-full text-sm sm:w-36"
              />
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">{t("to")}</Label>
              <Input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="h-8 w-full text-sm sm:w-36"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">{t("user")}</Label>
              <Select value={userId} onValueChange={setUserId}>
                <SelectTrigger className="h-8 w-full text-sm sm:w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("allUsers")}</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name ?? u.email ?? u.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2 sm:ml-auto">
              <Button size="sm" variant="outline" className="flex-1 sm:flex-none" onClick={handleExport}>
                <Download className="mr-2 h-3.5 w-3.5" />
                {t("exportCsv")}
              </Button>
              <Button size="sm" className="flex-1 sm:flex-none" onClick={refresh} disabled={isPending}>
                <RefreshCw className={`mr-2 h-3.5 w-3.5 ${isPending ? "animate-spin" : ""}`} />
                {t("apply")}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-4">
        <StatCard
          title={t("kpi.trackedActions")}
          value={kpis.activityCount}
          icon={Activity}
          color="border-l-blue-500"
          sub={t("kpi.trackedActionsSub")}
        />
        <StatCard
          title={t("kpi.tasksCompleted")}
          value={`${kpis.tasksCompleted} / ${kpis.tasksTotal}`}
          icon={CheckCircle2}
          color="border-l-green-500"
          sub={t("kpi.tasksCompletedSub", { rate: kpis.taskCompletionRate })}
        />
        <StatCard
          title={t("kpi.dealsWon")}
          // Won out of those decided in the period — the same base the win rate uses.
          value={`${kpis.dealsWon} / ${kpis.dealsWon + kpis.dealsLost}`}
          icon={TrendingUp}
          color="border-l-violet-500"
          sub={t("kpi.dealsWonSub", { rate: kpis.dealWinRate === null ? "—" : `${kpis.dealWinRate}%` })}
        />
        <StatCard
          title={t("kpi.newLeads")}
          value={kpis.leadsCreated}
          icon={Users}
          color="border-l-orange-500"
          sub={t("kpi.newLeadsSub")}
        />
        <StatCard
          title={t("kpi.quotesCreated")}
          value={kpis.quotesCreated}
          icon={FileText}
          color="border-l-cyan-500"
          sub={t("kpi.quotesCreatedSub")}
        />
        <StatCard
          title={t("kpi.openTickets")}
          value={kpis.openTickets}
          icon={Ticket}
          color="border-l-amber-500"
          sub={t("kpi.openTicketsSub")}
        />
        <StatCard
          title={t("kpi.winRate")}
          value={kpis.dealWinRate === null ? "—" : `${kpis.dealWinRate}%`}
          icon={Target}
          color="border-l-emerald-500"
          sub={t("kpi.winRateSub")}
        />
        <StatCard
          title={t("kpi.taskRate")}
          value={`${kpis.taskCompletionRate}%`}
          icon={CheckCircle2}
          color="border-l-pink-500"
          sub={t("kpi.taskRateSub")}
        />
      </div>

      {/* Tabs */}
      <Tabs defaultValue="activity">
        {/* ⚠️ No audit log tab. It read `user_activity_log`, which nothing has ever written:
            always empty, it told a manager the team had done nothing. A history of who
            changed what belongs on the records themselves. */}
        <TabsList className="w-full max-w-2xl">
          <TabsTrigger value="activity" className="flex-1 gap-1.5">
            <Activity className="h-3.5 w-3.5 max-sm:hidden" />
            {t("tabs.activity")}
          </TabsTrigger>
          <TabsTrigger value="performance" className="flex-1 gap-1.5">
            <Medal className="h-3.5 w-3.5 max-sm:hidden" />
            {t("tabs.performance")}
          </TabsTrigger>
          <TabsTrigger value="sales" className="flex-1 gap-1.5">
            <DollarSign className="h-3.5 w-3.5 max-sm:hidden" />
            {t("tabs.sales")}
          </TabsTrigger>
        </TabsList>

        {/* ── Activity tab ─────────────────────────────────────────── */}
        <TabsContent value="activity" className="space-y-5 mt-5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Daily trend */}
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">{t("charts.dailyTrend")}</CardTitle>
                <CardDescription className="text-xs">{t("charts.dailyTrendDesc")}</CardDescription>
              </CardHeader>
              <CardContent>
                {dailyTrend.length === 0 ? (
                  <EmptyChart label={noDataLabel} />
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={dailyTrend}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis
                        dataKey="day"
                        tick={{ fontSize: 11 }}
                        tickFormatter={(v) => format(new Date(v), "MMM d")}
                      />
                      <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                      <Tooltip
                        contentStyle={{ borderRadius: 8, border: "1px solid hsl(var(--border))", fontSize: 12 }}
                        labelFormatter={(v) => format(new Date(v), "MMM d, yyyy")}
                      />
                      <Line
                        type="monotone"
                        dataKey="count"
                        stroke="#3b82f6"
                        strokeWidth={2}
                        dot={{ r: 3 }}
                        activeDot={{ r: 5 }}
                        name={t("charts.actionsLabel")}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* Actions by type */}
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">{t("charts.actionsByType")}</CardTitle>
                <CardDescription className="text-xs">{t("charts.actionsByTypeDesc")}</CardDescription>
              </CardHeader>
              <CardContent>
                {activityByAction.length === 0 ? (
                  <EmptyChart label={noDataLabel} />
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={activityByAction.slice(0, 10)} layout="vertical" margin={{ left: 8, right: 8 }}>
                      <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                      <YAxis
                        type="category"
                        dataKey="action"
                        tick={{ fontSize: 10 }}
                        width={isMobile ? 84 : 110}
                        tickFormatter={(v) => actionLabels[v] ?? v}
                      />
                      <Tooltip
                        contentStyle={{ borderRadius: 8, border: "1px solid hsl(var(--border))", fontSize: 12 }}
                        formatter={(v, _n, props) => [v, actionLabels[props.payload.action] ?? props.payload.action]}
                      />
                      <Bar dataKey="count" radius={[0, 4, 4, 0]} name="Count">
                        {activityByAction.slice(0, 10).map((e, i) => (
                          <Cell key={e.action} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          {/* User leaderboard */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">{t("charts.userLeaderboard")}</CardTitle>
              <CardDescription className="text-xs">{t("charts.userLeaderboardDesc")}</CardDescription>
            </CardHeader>
            <CardContent>
              {activityByUser.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">{t("noActivity")}</p>
              ) : (
                <div className="space-y-3">
                  {activityByUser.slice(0, 10).map((u, i) => {
                    const max = activityByUser[0].count;
                    return (
                      <div key={u.userId} className="flex items-center gap-3">
                        <span className="text-xs font-bold w-5 text-muted-foreground tabular-nums">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-medium truncate">{u.userName}</span>
                            <span className="text-xs font-semibold tabular-nums ml-2">{u.count}</span>
                          </div>
                          <Progress value={max > 0 ? (u.count / max) * 100 : 0} className="h-1.5" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Performance tab ──────────────────────────────────────── */}
        <TabsContent value="performance" className="space-y-5 mt-5">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">{t("charts.taskPerf")}</CardTitle>
              <CardDescription className="text-xs">{t("charts.taskPerfDesc")}</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {taskPerf.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center px-6">{t("noTaskData")}</p>
              ) : (
                <ResponsiveRecordList
                  cards={
                    <RecordCards
                      className="px-4 pb-4"
                      items={taskPerf.map((u) => ({
                        id: u.userId,
                        title: u.userName,
                        badge: <span className="text-xs font-semibold tabular-nums">{u.completionRate}%</span>,
                        meta: (
                          <>
                            <span className="text-xs text-muted-foreground">
                              {t("cols.total")} <span className="tabular-nums text-foreground">{u.tasksTotal}</span>
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {t("cols.done")}{" "}
                              <span className="tabular-nums font-medium text-green-600">{u.tasksCompleted}</span>
                            </span>
                            {u.tasksOverdue > 0 && (
                              <span className="flex items-center gap-1 text-xs font-medium text-red-500">
                                <AlertTriangle className="h-3 w-3" />
                                {t("cols.overdue")} {u.tasksOverdue}
                              </span>
                            )}
                            <Progress value={u.completionRate} className="mt-1 h-1.5 w-full" />
                          </>
                        ),
                      }))}
                    />
                  }
                  table={
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/40 hover:bg-muted/40">
                          <TableHead className="text-xs font-semibold">{t("cols.user")}</TableHead>
                          <TableHead className="text-xs font-semibold text-right">{t("cols.total")}</TableHead>
                          <TableHead className="text-xs font-semibold text-right">{t("cols.done")}</TableHead>
                          <TableHead className="text-xs font-semibold text-right">{t("cols.overdue")}</TableHead>
                          <TableHead className="text-xs font-semibold">{t("cols.completionRate")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {taskPerf.map((u) => (
                          <TableRow key={u.userId}>
                            <TableCell className="font-medium text-sm">{u.userName}</TableCell>
                            <TableCell className="text-right tabular-nums text-sm">{u.tasksTotal}</TableCell>
                            <TableCell className="text-right tabular-nums text-sm text-green-600 font-medium">
                              {u.tasksCompleted}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-sm">
                              {u.tasksOverdue > 0 ? (
                                <span className="text-red-500 font-medium flex items-center justify-end gap-1">
                                  <AlertTriangle className="h-3 w-3" />
                                  {u.tasksOverdue}
                                </span>
                              ) : (
                                "—"
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <Progress value={u.completionRate} className="h-2 flex-1" />
                                <span className="text-xs font-semibold tabular-nums w-9 text-right">
                                  {u.completionRate}%
                                </span>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  }
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Sales tab ────────────────────────────────────────────── */}
        <TabsContent value="sales" className="space-y-5 mt-5">
          {/* Revenue KPI cards */}
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <StatCard
              title={t("kpi.totalRevenue")}
              value={formatAmount(salesReport.totalRevenue)}
              icon={DollarSign}
              color="border-l-green-500"
              sub={t("kpi.totalRevenueSub")}
            />
            <StatCard
              title={t("kpi.dealsWonSales")}
              value={salesReport.dealsWon.count}
              icon={TrendingUp}
              color="border-l-blue-500"
              sub={t("kpi.dealsWonSalesSub", { value: formatAmount(salesReport.dealsWon.revenue) })}
            />
            <StatCard
              title={t("kpi.quotesAccepted")}
              value={salesReport.quotesAccepted.count}
              icon={FileText}
              color="border-l-violet-500"
              sub={t("kpi.quotesAcceptedSub", { value: formatAmount(salesReport.quotesAccepted.revenue) })}
            />
            <StatCard
              title={t("kpi.ordersCompleted")}
              value={salesReport.ordersCompleted.count}
              icon={ShoppingCart}
              color="border-l-orange-500"
              sub={
                salesReport.ordersCompleted.unconverted > 0
                  ? t("kpi.ordersCompletedSubUnconverted", {
                      value: formatAmount(salesReport.ordersCompleted.revenue),
                      count: salesReport.ordersCompleted.unconverted,
                    })
                  : t("kpi.ordersCompletedSub", { value: formatAmount(salesReport.ordersCompleted.revenue) })
              }
            />
          </div>

          {/* ⚠️ No "revenue by stage" beside it: won deals all sit in the won stage, so it was
              one bar, always. */}
          <div className="grid grid-cols-1 gap-5">
            {/* Monthly revenue trend */}
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">{t("charts.monthlyRevenue")}</CardTitle>
                <CardDescription className="text-xs">{t("charts.monthlyRevenueDesc")}</CardDescription>
              </CardHeader>
              <CardContent>
                {salesReport.monthlyRevenue.length === 0 ? (
                  <EmptyChart label={noDataLabel} />
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={salesReport.monthlyRevenue}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatAmount(v, { noDecimals: true })} />
                      <Tooltip
                        contentStyle={{ borderRadius: 8, border: "1px solid hsl(var(--border))", fontSize: 12 }}
                        formatter={(v: number) => [formatAmount(v), t("charts.revenueLabel")]}
                      />
                      <Bar dataKey="revenue" fill="#22c55e" radius={[4, 4, 0, 0]} name={t("charts.revenueLabel")} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
