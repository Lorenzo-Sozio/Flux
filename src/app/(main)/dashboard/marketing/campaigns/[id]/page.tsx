import { getCampaignReport, getEmailTemplates } from "@/actions/marketing";
import { notFound } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  ChevronLeft,
  Send,
  Eye,
  MousePointerClick,
  AlertCircle,
  UserMinus,
  Clock,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { CampaignModal } from "@/components/crm/campaign-modal";
import { CampaignLogTable } from "../_components/campaign-log-table";

const CAMPAIGN_STATUS: Record<string, { label: string; className: string }> = {
  draft:     { label: "Draft",     className: "border-slate-300 text-slate-600" },
  active:    { label: "Active",    className: "border-green-300 text-green-700 bg-green-50" },
  completed: { label: "Completed", className: "border-blue-300 text-blue-700 bg-blue-50" },
};

interface Props {
  params: Promise<{ id: string }>;
}

export default async function CampaignDetailPage({ params }: Props) {
  const { id } = await params;
  const [report, templates] = await Promise.all([
    getCampaignReport(id),
    getEmailTemplates(),
  ]);
  if (!report) notFound();

  const { campaign, stats, logs } = report;
  const statusCfg  = CAMPAIGN_STATUS[campaign.status] ?? CAMPAIGN_STATUS.draft;
  const templateName = templates.find((t) => t.id === campaign.templateId)?.name;

  const statCards = [
    { label: "Queued",       value: stats.queued,      icon: Clock,              color: "text-slate-400" },
    { label: "Sent",         value: stats.sent,         icon: Send,               color: "text-blue-500" },
    { label: "Opened",       value: stats.opened,       icon: Eye,                color: "text-violet-500" },
    { label: "Clicked",      value: stats.clicked,      icon: MousePointerClick,  color: "text-green-500" },
    { label: "Bounced",      value: stats.bounced,      icon: AlertCircle,        color: "text-amber-500" },
    { label: "Unsubscribed", value: stats.unsubscribed, icon: UserMinus,          color: "text-orange-500" },
    { label: "Failed",       value: stats.failed,       icon: AlertCircle,        color: "text-red-500" },
  ];

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* ── Header ── */}
      <div>
        <Link
          href="/dashboard/marketing/campaigns"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to Campaigns
        </Link>

        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl font-bold tracking-tight">{campaign.name}</h1>
              <Badge variant="outline" className={`text-xs ${statusCfg.className}`}>
                {statusCfg.label}
              </Badge>
              {/* Tracking always-on badge */}
              <Badge variant="outline" className="text-xs border-emerald-300 text-emerald-700 bg-emerald-50 gap-1">
                <ShieldCheck className="h-3 w-3" />
                Open + Click tracking
              </Badge>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {templateName && (
                <span className="flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5" />
                  {templateName}
                </span>
              )}
              <span className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                Created {format(new Date(campaign.createdAt), "MMM d, yyyy")}
              </span>
            </div>
          </div>
          <CampaignModal
            templates={templates}
            campaign={{
              id: campaign.id,
              name: campaign.name,
              description: campaign.description ?? undefined,
              status: campaign.status,
              templateId: campaign.templateId ?? undefined,
            }}
          />
        </div>

        {campaign.description && (
          <p className="text-sm text-muted-foreground mt-2">{campaign.description}</p>
        )}
      </div>

      {/* ── Stats grid ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {statCards.map(({ label, value, icon: Icon, color }) => (
          <Card key={label} className="border shadow-none text-center">
            <CardContent className="pt-4 pb-3">
              <Icon className={`h-4 w-4 mx-auto mb-1.5 ${color}`} />
              <p className="text-lg font-bold tabular-nums leading-none">{value}</p>
              <p className="text-[11px] text-muted-foreground mt-1">{label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Engagement funnel ── */}
      {stats.sent > 0 && (
        <Card className="shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Engagement Funnel</CardTitle>
            <CardDescription className="text-xs">
              Tracking self-hosted — data updates as recipients interact.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Open rate */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-center text-sm">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Eye className="h-3.5 w-3.5 text-violet-500" />
                  Open Rate
                  <span className="text-[10px] text-muted-foreground">({stats.opened}/{stats.sent})</span>
                </span>
                <span className="font-semibold tabular-nums">{stats.openRate}%</span>
              </div>
              <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-violet-500 rounded-full transition-all"
                  style={{ width: `${Math.min(parseFloat(stats.openRate), 100)}%` }}
                />
              </div>
            </div>

            {/* Click rate */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-center text-sm">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <MousePointerClick className="h-3.5 w-3.5 text-green-500" />
                  Click Rate
                  <span className="text-[10px] text-muted-foreground">({stats.clicked}/{stats.sent})</span>
                </span>
                <span className="font-semibold tabular-nums">{stats.clickRate}%</span>
              </div>
              <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-green-500 rounded-full transition-all"
                  style={{ width: `${Math.min(parseFloat(stats.clickRate), 100)}%` }}
                />
              </div>
            </div>

            {/* CTR of openers */}
            {stats.opened > 0 && (
              <div className="space-y-1.5">
                <div className="flex justify-between items-center text-sm">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <MousePointerClick className="h-3.5 w-3.5 text-emerald-500" />
                    Click-to-Open Rate
                    <span className="text-[10px] text-muted-foreground">({stats.clicked}/{stats.opened})</span>
                  </span>
                  <span className="font-semibold tabular-nums">
                    {((stats.clicked / stats.opened) * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full transition-all"
                    style={{ width: `${Math.min((stats.clicked / stats.opened) * 100, 100)}%` }}
                  />
                </div>
              </div>
            )}

            {/* Negative events summary */}
            {(stats.bounced > 0 || stats.unsubscribed > 0 || stats.complained > 0) && (
              <div className="flex flex-wrap gap-3 pt-2 border-t text-xs text-muted-foreground">
                {stats.bounced > 0 && (
                  <span className="flex items-center gap-1">
                    <AlertCircle className="h-3 w-3 text-amber-500" />
                    {stats.bounced} bounced
                  </span>
                )}
                {stats.unsubscribed > 0 && (
                  <span className="flex items-center gap-1">
                    <UserMinus className="h-3 w-3 text-orange-500" />
                    {stats.unsubscribed} unsubscribed
                  </span>
                )}
                {stats.complained > 0 && (
                  <span className="flex items-center gap-1">
                    <AlertCircle className="h-3 w-3 text-red-500" />
                    {stats.complained} complaints
                  </span>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Send Log with filtering ── */}
      <Card className="shadow-none">
        <CardHeader className="pb-3">
          <div>
            <CardTitle className="text-sm font-semibold">Send Log</CardTitle>
            <CardDescription className="text-xs mt-0.5">
              {stats.total} total recipients — filter by status or search by name / email
            </CardDescription>
          </div>
        </CardHeader>
        <Separator />
        <CardContent className="pt-4 pb-2">
          <CampaignLogTable logs={logs} total={stats.total} />
        </CardContent>
      </Card>
    </div>
  );
}
