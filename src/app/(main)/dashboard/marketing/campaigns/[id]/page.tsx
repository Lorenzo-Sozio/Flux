import { getCampaignReport, getEmailTemplates } from "@/actions/marketing";
import { notFound } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ChevronLeft,
  Send,
  Eye,
  MousePointerClick,
  AlertCircle,
  UserMinus,
  CheckCircle2,
  Clock,
  Mail,
} from "lucide-react";
import { CampaignModal } from "@/components/crm/campaign-modal";

const STATUS_LOG_CONFIG: Record<string, { label: string; className: string }> = {
  queued:       { label: "Queued",       className: "border-slate-300 text-slate-600" },
  sent:         { label: "Sent",         className: "border-blue-300 text-blue-700 bg-blue-50" },
  opened:       { label: "Opened",       className: "border-violet-300 text-violet-700 bg-violet-50" },
  clicked:      { label: "Clicked",      className: "border-green-300 text-green-700 bg-green-50" },
  bounced:      { label: "Bounced",      className: "border-amber-300 text-amber-700 bg-amber-50" },
  complained:   { label: "Complained",   className: "border-red-300 text-red-700 bg-red-50" },
  unsubscribed: { label: "Unsubscribed", className: "border-orange-300 text-orange-700 bg-orange-50" },
  failed:       { label: "Failed",       className: "border-red-400 text-red-800 bg-red-50" },
};

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
  const statusCfg = CAMPAIGN_STATUS[campaign.status] ?? CAMPAIGN_STATUS.draft;
  const templateName = templates.find((t) => t.id === campaign.templateId)?.name;

  const statCards = [
    { label: "Sent",         value: stats.sent,         icon: Send,              color: "text-blue-500" },
    { label: "Opened",       value: `${stats.opened} (${stats.openRate}%)`,  icon: Eye,               color: "text-violet-500" },
    { label: "Clicked",      value: `${stats.clicked} (${stats.clickRate}%)`, icon: MousePointerClick, color: "text-green-500" },
    { label: "Bounced",      value: stats.bounced,      icon: AlertCircle,       color: "text-amber-500" },
    { label: "Unsubscribed", value: stats.unsubscribed, icon: UserMinus,         color: "text-orange-500" },
    { label: "Failed",       value: stats.failed,       icon: AlertCircle,       color: "text-red-500" },
  ];

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
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
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold tracking-tight">{campaign.name}</h1>
              <Badge variant="outline" className={`text-xs ${statusCfg.className}`}>
                {statusCfg.label}
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
            campaign={{ id: campaign.id, name: campaign.name, description: campaign.description ?? undefined, status: campaign.status, templateId: campaign.templateId ?? undefined }}
          />
        </div>
        {campaign.description && (
          <p className="text-sm text-muted-foreground mt-2">{campaign.description}</p>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {statCards.map(({ label, value, icon: Icon, color }) => (
          <Card key={label} className="border-0 shadow-sm text-center">
            <CardContent className="pt-4 pb-3">
              <Icon className={`h-5 w-5 mx-auto mb-1.5 ${color}`} />
              <p className="text-lg font-bold tabular-nums">{value}</p>
              <p className="text-xs text-muted-foreground">{label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Open/click rate bar */}
      {stats.sent > 0 && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Engagement Rates</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="flex items-center gap-1.5 text-muted-foreground"><Eye className="h-3.5 w-3.5" />Open Rate</span>
                <span className="font-semibold">{stats.openRate}%</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-violet-500 rounded-full transition-all" style={{ width: `${Math.min(parseFloat(stats.openRate), 100)}%` }} />
              </div>
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="flex items-center gap-1.5 text-muted-foreground"><MousePointerClick className="h-3.5 w-3.5" />Click Rate</span>
                <span className="font-semibold">{stats.clickRate}%</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${Math.min(parseFloat(stats.clickRate), 100)}%` }} />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recipient log */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm font-semibold">Send Log</CardTitle>
              <CardDescription className="text-xs mt-0.5">{stats.total} total recipients</CardDescription>
            </div>
          </div>
        </CardHeader>
        <Separator />
        {logs.length === 0 ? (
          <CardContent className="py-12 text-center">
            <CheckCircle2 className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No sends yet. Launch the campaign to start.</p>
            <Button variant="outline" size="sm" className="mt-4" asChild>
              <Link href="/dashboard/marketing/campaigns">Go back</Link>
            </Button>
          </CardContent>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="text-xs font-semibold">Recipient</TableHead>
                <TableHead className="text-xs font-semibold">Status</TableHead>
                <TableHead className="text-xs font-semibold">Sent At</TableHead>
                <TableHead className="text-xs font-semibold">Opened</TableHead>
                <TableHead className="text-xs font-semibold">Clicked</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log) => {
                const logCfg = STATUS_LOG_CONFIG[log.status] ?? STATUS_LOG_CONFIG.queued;
                return (
                  <TableRow key={log.id}>
                    <TableCell className="text-sm font-mono text-xs text-muted-foreground">
                      {log.contactId ?? log.leadId ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-xs ${logCfg.className}`}>
                        {logCfg.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {format(new Date(log.sentAt), "MMM d, HH:mm")}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {log.openedAt ? format(new Date(log.openedAt), "MMM d, HH:mm") : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {log.clickedAt ? format(new Date(log.clickedAt), "MMM d, HH:mm") : "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
