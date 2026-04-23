import Link from "next/link";
import { getTranslations } from "next-intl/server";

import {
  AlertCircleIcon,
  CalendarIcon,
  ClipboardIcon,
  FileTextIcon,
  HeadphonesIcon,
  MailIcon,
  MessageSquareIcon,
  PhoneIcon,
  TargetIcon,
  TrendingUp,
  TrendingUpIcon,
  UsersIcon,
} from "lucide-react";

import { getLeads } from "@/actions/crm";
import { getDashboardStats, getRecentActivities, getTopDeals } from "@/actions/dashboard";
import CRMCharts from "@/components/dashboard/CRMCharts.client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

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
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default async function CRMPage() {
  const t = await getTranslations("crm");
  const tc = await getTranslations("common");

  const [stats, leads, topDeals, recentActivities] = await Promise.all([
    getDashboardStats(),
    getLeads(),
    getTopDeals(5),
    getRecentActivities(10),
  ]);

  const recentLeads = (leads || [])
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  return (
    <div className="p-6 space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-6">
        <Link href="/dashboard/pipeline" className="group">
          <Card className="border-l-4 border-l-blue-500 shadow-sm transition-shadow group-hover:shadow-md cursor-pointer">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{t("pipelineValue")}</CardTitle>
              <TrendingUpIcon className="h-4 w-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">€{stats.totalDealValue.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground mt-1">{t("pipelineValueDesc")}</p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/leads" className="group">
          <Card className="border-l-4 border-l-green-500 shadow-sm transition-shadow group-hover:shadow-md cursor-pointer">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{t("activeLeads")}</CardTitle>
              <UsersIcon className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.activeLeadsCount}</div>
              <p className="text-xs text-muted-foreground mt-1">{t("activeLeadsDesc")}</p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/leads" className="group">
          <Card className="border-l-4 border-l-orange-500 shadow-sm transition-shadow group-hover:shadow-md cursor-pointer">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{t("conversionRate")}</CardTitle>
              <TargetIcon className="h-4 w-4 text-orange-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.conversionRate}%</div>
              <p className="text-xs text-muted-foreground mt-1">{t("conversionRateDesc")}</p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/tasks" className="group">
          <Card className="border-l-4 border-l-red-500 shadow-sm transition-shadow group-hover:shadow-md cursor-pointer">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{t("pendingTasks")}</CardTitle>
              <AlertCircleIcon className="h-4 w-4 text-red-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.todayTasks + stats.overdueTasks}</div>
              <div className="flex gap-2 mt-1">
                <span className="text-[10px] text-red-600 font-bold uppercase">{t("overdueLabel", { count: stats.overdueTasks })}</span>
                <span className="text-[10px] text-muted-foreground uppercase">{t("todayLabel", { count: stats.todayTasks })}</span>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/quotes" className="group">
          <Card className="border-l-4 border-l-violet-500 shadow-sm transition-shadow group-hover:shadow-md cursor-pointer">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{t("quotesPipeline")}</CardTitle>
              <FileTextIcon className="h-4 w-4 text-violet-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">€{stats.quotesPipelineValue.toLocaleString()}</div>
              <div className="flex gap-2 mt-1">
                <span className="text-[10px] text-muted-foreground uppercase">{t("openQuotesCount", { count: stats.quotesOpenCount })}</span>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/support/tickets" className="group">
          <Card className="border-l-4 border-l-amber-500 shadow-sm transition-shadow group-hover:shadow-md cursor-pointer">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{t("openTickets")}</CardTitle>
              <HeadphonesIcon className="h-4 w-4 text-amber-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.openTicketsCount}</div>
              <div className="flex gap-2 mt-1">
                {stats.urgentTicketsCount > 0 ? (
                  <span className="text-[10px] text-red-600 font-bold uppercase">
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

      {/* Charts */}
      <CRMCharts dealDistribution={stats.dealDistribution} leadsBySource={stats.leadsBySource} />

      {/* Top Deals + Recent Activities */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Top Deals */}
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
              <p className="text-center text-muted-foreground italic py-8">{t("noOpenDeals")}</p>
            ) : (
              <div className="divide-y">
                {topDeals.map((deal) => (
                  <Link
                    key={deal.id}
                    href={`/dashboard/pipeline`}
                    className="flex items-center justify-between px-6 py-3 hover:bg-muted/40 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{deal.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {deal.stageName && (
                          <span
                            className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full uppercase"
                            style={{ backgroundColor: `${deal.stageColor}22`, color: deal.stageColor ?? "#3b82f6" }}
                          >
                            {deal.stageName}
                          </span>
                        )}
                        {deal.companyName && (
                          <span className="text-xs text-muted-foreground truncate">{deal.companyName}</span>
                        )}
                      </div>
                    </div>
                    <div className="text-right ml-4 shrink-0">
                      <p className="font-semibold text-sm">€{deal.amount.toLocaleString()}</p>
                      {deal.probability != null && (
                        <p className="text-[11px] text-muted-foreground">{t("probPercent", { prob: deal.probability })}</p>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Activities */}
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
              <p className="text-center text-muted-foreground italic py-8">{t("noActivitiesYet")}</p>
            ) : (
              <div className="divide-y">
                {recentActivities.map((act) => {
                  const entityName = act.contactFirstName
                    ? `${act.contactFirstName} ${act.contactLastName ?? ""}`.trim()
                    : (act.companyName ?? null);

                  return (
                    <div key={act.id} className="flex items-start gap-3 px-6 py-3">
                      <div className="mt-0.5 shrink-0 flex h-7 w-7 items-center justify-center rounded-full bg-muted">
                        {ACTIVITY_ICON[act.type] ?? <ClipboardIcon className="h-3.5 w-3.5 text-muted-foreground" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-semibold capitalize">{act.type}</span>
                          {entityName && <span className="text-xs text-muted-foreground">— {entityName}</span>}
                        </div>
                        {act.content && (
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{act.content}</p>
                        )}
                        <div className="flex items-center gap-2 mt-1">
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

      {/* Recent Leads */}
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
                  <TableCell colSpan={5} className="text-center py-4 text-muted-foreground">
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
