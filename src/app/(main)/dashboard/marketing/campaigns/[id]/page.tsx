import Link from "next/link";
import { notFound } from "next/navigation";

import { format } from "date-fns";
import {
  AlertCircle,
  ChevronLeft,
  Clock,
  Eye,
  Mail,
  MousePointerClick,
  Send,
  ShieldCheck,
  UserMinus,
} from "lucide-react";

import { getCampaignReport, getEmailTemplates } from "@/actions/marketing";
import { CampaignModal } from "@/components/crm/campaign-modal";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

import { CampaignLogTable } from "../_components/campaign-log-table";

const CAMPAIGN_STATUS: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "border-slate-300 text-slate-600" },
  active: { label: "Active", className: "border-green-300 text-green-700 bg-green-50" },
  completed: { label: "Completed", className: "border-blue-300 text-blue-700 bg-blue-50" },
};

interface Props {
  params: Promise<{ id: string }>;
}

export default async function CampaignDetailPage({ params }: Props) {
  const { id } = await params;
  const [report, templates] = await Promise.all([getCampaignReport(id), getEmailTemplates()]);
  if (!report) notFound();

  const { campaign, stats, logs } = report;
  const statusCfg = CAMPAIGN_STATUS[campaign.status] ?? CAMPAIGN_STATUS.draft;
  const templateName = templates.find((t) => t.id === campaign.templateId)?.name;

  const statCards = [
    { label: "Queued", value: stats.queued, icon: Clock, color: "text-slate-400" },
    { label: "Sent", value: stats.sent, icon: Send, color: "text-blue-500" },
    { label: "Opened", value: stats.opened, icon: Eye, color: "text-violet-500" },
    { label: "Clicked", value: stats.clicked, icon: MousePointerClick, color: "text-green-500" },
    { label: "Bounced", value: stats.bounced, icon: AlertCircle, color: "text-amber-500" },
    { label: "Unsubscribed", value: stats.unsubscribed, icon: UserMinus, color: "text-orange-500" },
    { label: "Failed", value: stats.failed, icon: AlertCircle, color: "text-red-500" },
  ];

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div>
        <Link
          href="/dashboard/marketing/campaigns"
          className="mb-3 inline-flex items-center gap-1 text-muted-foreground text-sm transition-colors hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to Campaigns
        </Link>

        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-bold text-xl tracking-tight">{campaign.name}</h1>
              <Badge variant="outline" className={`text-xs ${statusCfg.className}`}>
                {statusCfg.label}
              </Badge>
              {/* Tracking always-on badge */}
              <Badge variant="outline" className="gap-1 border-emerald-300 bg-emerald-50 text-emerald-700 text-xs">
                <ShieldCheck className="h-3 w-3" />
                Open + Click tracking
              </Badge>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-sm">
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

        {campaign.description && <p className="mt-2 text-muted-foreground text-sm">{campaign.description}</p>}
      </div>

      {/* ── Stats grid ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {statCards.map(({ label, value, icon: Icon, color }) => (
          <Card key={label} className="border text-center shadow-none">
            <CardContent className="pt-4 pb-3">
              <Icon className={`mx-auto mb-1.5 h-4 w-4 ${color}`} />
              <p className="font-bold text-lg tabular-nums leading-none">{value}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">{label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Engagement funnel ── */}
      {stats.sent > 0 && (
        <Card className="shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="font-semibold text-sm">Engagement Funnel</CardTitle>
            <CardDescription className="text-xs">
              Tracking self-hosted — data updates as recipients interact.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Open rate */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Eye className="h-3.5 w-3.5 text-violet-500" />
                  Open Rate
                  <span className="text-[10px] text-muted-foreground">
                    ({stats.opened}/{stats.sent})
                  </span>
                </span>
                <span className="font-semibold tabular-nums">{stats.openRate}%</span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-violet-500 transition-all"
                  style={{ width: `${Math.min(parseFloat(stats.openRate), 100)}%` }}
                />
              </div>
            </div>

            {/* Click rate */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <MousePointerClick className="h-3.5 w-3.5 text-green-500" />
                  Click Rate
                  <span className="text-[10px] text-muted-foreground">
                    ({stats.clicked}/{stats.sent})
                  </span>
                </span>
                <span className="font-semibold tabular-nums">{stats.clickRate}%</span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-green-500 transition-all"
                  style={{ width: `${Math.min(parseFloat(stats.clickRate), 100)}%` }}
                />
              </div>
            </div>

            {/* CTR of openers */}
            {stats.opened > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <MousePointerClick className="h-3.5 w-3.5 text-emerald-500" />
                    Click-to-Open Rate
                    <span className="text-[10px] text-muted-foreground">
                      ({stats.clicked}/{stats.opened})
                    </span>
                  </span>
                  <span className="font-semibold tabular-nums">
                    {((stats.clicked / stats.opened) * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all"
                    style={{ width: `${Math.min((stats.clicked / stats.opened) * 100, 100)}%` }}
                  />
                </div>
              </div>
            )}

            {/* Negative events summary */}
            {(stats.bounced > 0 || stats.unsubscribed > 0 || stats.complained > 0) && (
              <div className="flex flex-wrap gap-3 border-t pt-2 text-muted-foreground text-xs">
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
            <CardTitle className="font-semibold text-sm">Send Log</CardTitle>
            <CardDescription className="mt-0.5 text-xs">
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
