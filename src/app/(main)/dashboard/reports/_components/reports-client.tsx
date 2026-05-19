"use client";

import { useCallback, useState, useTransition } from "react";

import { format, subDays } from "date-fns";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  DollarSign,
  Download,
  Eye,
  FileText,
  Medal,
  MousePointerClick,
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
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";

import {
  getActivityByAction,
  getActivityByUser,
  getCampaignPerformanceSummary,
  getDailyActivityTrend,
  getRecentActivityLog,
  getReportKPIs,
  getSalesReport,
  getTaskPerformanceByUser,
} from "@/actions/reports";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// ─── Types ─────────────────────────────────────────────────────────────────────
type User = { id: string; name: string | null; email: string | null; role: string };

type KPIs = Awaited<ReturnType<typeof getReportKPIs>>;
type ActivityByUser = Awaited<ReturnType<typeof getActivityByUser>>;
type ActivityByAction = Awaited<ReturnType<typeof getActivityByAction>>;
type DailyTrend = Awaited<ReturnType<typeof getDailyActivityTrend>>;
type TaskPerf = Awaited<ReturnType<typeof getTaskPerformanceByUser>>;
type LogEntry = Awaited<ReturnType<typeof getRecentActivityLog>>[number];
type CampaignPerf = Awaited<ReturnType<typeof getCampaignPerformanceSummary>>;
type SalesReport = Awaited<ReturnType<typeof getSalesReport>>;

interface InitialData {
  kpis: KPIs;
  activityByUser: ActivityByUser;
  activityByAction: ActivityByAction;
  dailyTrend: DailyTrend;
  taskPerf: TaskPerf;
  recentLog: LogEntry[];
  campaignPerf: CampaignPerf;
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
    <Card className={`border-l-4 shadow-sm ${color}`}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
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
  const actionLabels = t.raw("actionLabels") as Record<string, string>;
  const defaultFrom = format(subDays(new Date(), 29), "yyyy-MM-dd");
  const defaultTo = format(new Date(), "yyyy-MM-dd");

  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [userId, setUserId] = useState("all");
  const [data, setData] = useState(initial);
  const [isPending, startTransition] = useTransition();

  const refresh = useCallback(() => {
    startTransition(async () => {
      try {
        const filters = {
          from,
          to,
          userId: userId === "all" ? undefined : userId,
        };
        const [kpis, activityByUser, activityByAction, dailyTrend, taskPerf, recentLog, campaignPerf, salesReport] =
          await Promise.all([
            getReportKPIs(filters),
            getActivityByUser(filters),
            getActivityByAction(filters),
            getDailyActivityTrend(filters),
            getTaskPerformanceByUser(filters),
            getRecentActivityLog({ ...filters, limit: 100 }),
            getCampaignPerformanceSummary(filters),
            getSalesReport(filters),
          ]);
        setData({ kpis, activityByUser, activityByAction, dailyTrend, taskPerf, recentLog, campaignPerf, salesReport });
      } catch {
        toast.error(t("refreshFailed"));
      }
    });
  }, [from, to, userId]);

  const handleExport = () => {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (userId !== "all") params.set("userId", userId);
    window.open(`/api/reports/export?${params}`, "_blank");
  };

  const { kpis, activityByUser, activityByAction, dailyTrend, taskPerf, recentLog, campaignPerf, salesReport } = data;
  const noDataLabel = t("noData");

  return (
    <div className="space-y-6">
      {/* Filter bar */}
      <Card className="border-0 shadow-sm">
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">{t("from")}</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 text-sm w-36" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">{t("to")}</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 text-sm w-36" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">{t("user")}</Label>
              <Select value={userId} onValueChange={setUserId}>
                <SelectTrigger className="h-8 text-sm w-44">
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
            <div className="flex gap-2 ml-auto">
              <Button size="sm" variant="outline" onClick={handleExport}>
                <Download className="mr-2 h-3.5 w-3.5" />
                {t("exportCsv")}
              </Button>
              <Button size="sm" onClick={refresh} disabled={isPending}>
                <RefreshCw className={`mr-2 h-3.5 w-3.5 ${isPending ? "animate-spin" : ""}`} />
                {t("apply")}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-4 gap-4">
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
          value={`${kpis.dealsWon} / ${kpis.dealsCreated}`}
          icon={TrendingUp}
          color="border-l-violet-500"
          sub={t("kpi.dealsWonSub", { rate: kpis.dealWinRate })}
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
          value={`${kpis.dealWinRate}%`}
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
        <TabsList className="w-full max-w-2xl">
          <TabsTrigger value="activity" className="flex-1 gap-1.5">
            <Activity className="h-3.5 w-3.5" />
            {t("tabs.activity")}
          </TabsTrigger>
          <TabsTrigger value="performance" className="flex-1 gap-1.5">
            <Medal className="h-3.5 w-3.5" />
            {t("tabs.performance")}
          </TabsTrigger>
          <TabsTrigger value="sales" className="flex-1 gap-1.5">
            <DollarSign className="h-3.5 w-3.5" />
            {t("tabs.sales")}
          </TabsTrigger>
          <TabsTrigger value="campaigns" className="flex-1 gap-1.5">
            <Target className="h-3.5 w-3.5" />
            {t("tabs.campaigns")}
          </TabsTrigger>
          <TabsTrigger value="log" className="flex-1 gap-1.5">
            <FileText className="h-3.5 w-3.5" />
            {t("tabs.auditLog")}
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
                        width={110}
                        tickFormatter={(v) => actionLabels[v] ?? v}
                      />
                      <Tooltip
                        contentStyle={{ borderRadius: 8, border: "1px solid hsl(var(--border))", fontSize: 12 }}
                        formatter={(v, _n, props) => [v, actionLabels[props.payload.action] ?? props.payload.action]}
                      />
                      <Bar dataKey="count" radius={[0, 4, 4, 0]} name="Count">
                        {activityByAction.slice(0, 10).map((_e, i) => (
                          <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
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
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Sales tab ────────────────────────────────────────────── */}
        <TabsContent value="sales" className="space-y-5 mt-5">
          {/* Revenue KPI cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              title={t("kpi.totalRevenue")}
              value={`€${salesReport.totalRevenue.toLocaleString()}`}
              icon={DollarSign}
              color="border-l-green-500"
              sub={t("kpi.totalRevenueSub")}
            />
            <StatCard
              title={t("kpi.dealsWonSales")}
              value={salesReport.dealsWon.count}
              icon={TrendingUp}
              color="border-l-blue-500"
              sub={t("kpi.dealsWonSalesSub", { value: salesReport.dealsWon.revenue.toLocaleString() })}
            />
            <StatCard
              title={t("kpi.quotesAccepted")}
              value={salesReport.quotesAccepted.count}
              icon={FileText}
              color="border-l-violet-500"
              sub={t("kpi.quotesAcceptedSub", { value: salesReport.quotesAccepted.revenue.toLocaleString() })}
            />
            <StatCard
              title={t("kpi.ordersCompleted")}
              value={salesReport.ordersCompleted.count}
              icon={ShoppingCart}
              color="border-l-orange-500"
              sub={t("kpi.ordersCompletedSub", { value: salesReport.ordersCompleted.revenue.toLocaleString() })}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
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
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `€${(v / 1000).toFixed(0)}k`} />
                      <Tooltip
                        contentStyle={{ borderRadius: 8, border: "1px solid hsl(var(--border))", fontSize: 12 }}
                        formatter={(v: number) => [`€${v.toLocaleString()}`, t("charts.revenueLabel")]}
                      />
                      <Bar dataKey="revenue" fill="#22c55e" radius={[4, 4, 0, 0]} name={t("charts.revenueLabel")} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* Revenue by stage */}
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">{t("charts.revenueByStage")}</CardTitle>
                <CardDescription className="text-xs">{t("charts.revenueByStageDesc")}</CardDescription>
              </CardHeader>
              <CardContent>
                {salesReport.revenueByStage.length === 0 ? (
                  <EmptyChart label={noDataLabel} />
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={salesReport.revenueByStage} layout="vertical" margin={{ left: 8, right: 8 }}>
                      <XAxis
                        type="number"
                        tick={{ fontSize: 11 }}
                        tickFormatter={(v) => `€${(v / 1000).toFixed(0)}k`}
                      />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={100} />
                      <Tooltip
                        contentStyle={{ borderRadius: 8, fontSize: 12 }}
                        formatter={(v: number) => [`€${v.toLocaleString()}`, t("charts.revenueLabel")]}
                      />
                      <Bar dataKey="revenue" radius={[0, 4, 4, 0]}>
                        {salesReport.revenueByStage.map((entry, i) => (
                          <Cell key={`cell-${i}`} fill={entry.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Campaigns tab ────────────────────────────────────────── */}
        <TabsContent value="campaigns" className="space-y-5 mt-5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">{t("charts.campaignEngagement")}</CardTitle>
                <CardDescription className="text-xs">{t("charts.campaignEngagementDesc")}</CardDescription>
              </CardHeader>
              <CardContent>
                {campaignPerf.length === 0 ? (
                  <EmptyChart label={noDataLabel} />
                ) : (
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={campaignPerf.filter((c) => c.sent > 0)}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis
                        dataKey="name"
                        tick={{ fontSize: 10 }}
                        tickFormatter={(v) => (v.length > 14 ? `${v.slice(0, 14)}…` : v)}
                      />
                      <YAxis tick={{ fontSize: 11 }} unit="%" />
                      <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                      <Legend />
                      <Bar dataKey="openRate" name={t("charts.openPct")} fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="clickRate" name={t("charts.clickPct")} fill="#10b981" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">{t("charts.campaignVolume")}</CardTitle>
                <CardDescription className="text-xs">{t("charts.campaignVolumeDesc")}</CardDescription>
              </CardHeader>
              <CardContent>
                {campaignPerf.filter((c) => c.sent > 0).length === 0 ? (
                  <EmptyChart label={noDataLabel} />
                ) : (
                  <ResponsiveContainer width="100%" height={240}>
                    <PieChart>
                      <Pie
                        data={campaignPerf.filter((c) => c.sent > 0)}
                        dataKey="sent"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={90}
                        label={({ name, percent }) => `${name.slice(0, 12)} ${(percent * 100).toFixed(0)}%`}
                        labelLine={false}
                      >
                        {campaignPerf
                          .filter((c) => c.sent > 0)
                          .map((_e, i) => (
                            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                          ))}
                      </Pie>
                      <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Campaign table */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">{t("charts.campaignSummary")}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {campaignPerf.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">{t("noCampaigns")}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead className="text-xs font-semibold">{t("cols.campaign")}</TableHead>
                      <TableHead className="text-xs font-semibold">{t("cols.status")}</TableHead>
                      <TableHead className="text-xs font-semibold text-right">{t("cols.recipients")}</TableHead>
                      <TableHead className="text-xs font-semibold text-right">
                        <span className="flex items-center justify-end gap-1">
                          <Eye className="h-3 w-3" />
                          {t("cols.opens")}
                        </span>
                      </TableHead>
                      <TableHead className="text-xs font-semibold text-right">
                        <span className="flex items-center justify-end gap-1">
                          <MousePointerClick className="h-3 w-3" />
                          {t("cols.clicks")}
                        </span>
                      </TableHead>
                      <TableHead className="text-xs font-semibold text-right">{t("cols.openPct")}</TableHead>
                      <TableHead className="text-xs font-semibold text-right">{t("cols.clickPct")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {campaignPerf.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium text-sm">{c.name}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs capitalize">
                            {c.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm">{c.sent}</TableCell>
                        <TableCell className="text-right tabular-nums text-sm text-violet-600">{c.opened}</TableCell>
                        <TableCell className="text-right tabular-nums text-sm text-green-600">{c.clicked}</TableCell>
                        <TableCell className="text-right tabular-nums text-sm font-medium">{c.openRate}%</TableCell>
                        <TableCell className="text-right tabular-nums text-sm font-medium">{c.clickRate}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Audit Log tab ─────────────────────────────────────────── */}
        <TabsContent value="log" className="mt-5">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-sm font-semibold">{t("tabs.auditLog")}</CardTitle>
                  <CardDescription className="text-xs mt-0.5">
                    {t("auditDesc", { count: recentLog.length })}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <Separator />
            {recentLog.length === 0 ? (
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                {t("auditNoActivity")}
              </CardContent>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead className="text-xs font-semibold">{t("cols.time")}</TableHead>
                    <TableHead className="text-xs font-semibold">{t("cols.user")}</TableHead>
                    <TableHead className="text-xs font-semibold">{t("cols.action")}</TableHead>
                    <TableHead className="text-xs font-semibold">{t("cols.entity")}</TableHead>
                    <TableHead className="text-xs font-semibold">{t("cols.ipAddress")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentLog.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                        {format(new Date(entry.createdAt), "MMM d, HH:mm:ss")}
                      </TableCell>
                      <TableCell className="text-sm font-medium">{entry.userName}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs font-mono">
                          {actionLabels[entry.action] ?? entry.action}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {entry.entityType ? <span className="capitalize">{entry.entityType}</span> : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground font-mono">
                        {entry.ipAddress ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
