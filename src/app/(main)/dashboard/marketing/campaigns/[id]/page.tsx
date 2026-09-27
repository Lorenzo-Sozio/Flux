import type { ReactNode } from "react";

import Link from "next/link";
import { notFound } from "next/navigation";

import {
  AlertCircle,
  CalendarClock,
  Clock,
  Eye,
  FileTextIcon,
  InfoIcon,
  Mail,
  MousePointerClick,
  ShieldCheck,
  UserMinus,
  UsersIcon,
} from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { getCampaignReport, getEmailTemplates, getSegments } from "@/actions/marketing";
import { auth } from "@/auth";
import { FormattedDate } from "@/components/crm/formatted-date";
import {
  EmptyHint,
  Field,
  FieldList,
  MetaItem,
  Metric,
  MetricStrip,
  RecordBackLink,
  RecordHero,
  RecordPage,
  StatusBadge,
  type Tone,
} from "@/components/crm/record/record-page";
import { RecordSections } from "@/components/crm/record/record-sections";
import { RecordVisit } from "@/components/crm/record-visit";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { can } from "@/lib/permissions";

import { CampaignLogTable } from "../_components/campaign-log-table";
import { CampaignActions } from "./_components/campaign-actions";

/**
 * The same four statuses the list shows, in the five shared tones: waiting on a
 * clock is amber, going out is blue, done is green — as on every other record.
 */
const STATUS_TONE: Record<string, Tone> = {
  draft: "neutral",
  scheduled: "warning",
  active: "info",
  completed: "success",
};

interface Props {
  params: Promise<{ id: string }>;
}

/**
 * One campaign, laid out for whoever has to decide what to do with it next.
 *
 * ⚠️ The order is the order of the questions: what state is it in and can it go
 * (the hero and its launch button), how did it do (the four figures and the
 * funnel), who got it (the log), what did it say (the content), and how is it set
 * up (the settings). A draft that has sent nothing opens on its content instead of
 * on an empty log, because for a draft that is the only thing there is to look at.
 */
export default async function CampaignDetailPage({ params }: Props) {
  const { id } = await params;
  const [report, templates, session, t, tM, tR, formatter] = await Promise.all([
    getCampaignReport(id),
    getEmailTemplates(),
    auth(),
    getTranslations("marketing.campaigns"),
    getTranslations("marketing"),
    getTranslations("record"),
    getFormatter(),
  ]);
  if (!report) notFound();

  const { campaign, stats, logs } = report;
  // A viewer reads the campaign; the controls that would only answer "forbidden"
  // are not drawn for them. The workspace role — see CLAUDE.md on the two scales.
  const canWrite = can(session?.user?.tenantRole ?? null, "record:write");
  const statusKey = campaign.status in STATUS_TONE ? campaign.status : "draft";
  const template = templates.find((tpl) => tpl.id === campaign.templateId) ?? null;

  // The segment by name, only when the campaign was aimed at one. ⚠️ Segments are
  // the saved filters of whoever made them, so a colleague's is not in this list:
  // that case says so rather than claiming the campaign goes to everybody.
  const segments = campaign.recipientType && campaign.recipientFilterId ? await getSegments().catch(() => []) : [];
  const segmentName = campaign.recipientFilterId
    ? (segments.find((s) => s.id === campaign.recipientFilterId)?.name ?? t("detail.segmentNotVisible"))
    : t("launch.everyoneEligible");

  const percent = (value: number) =>
    formatter.number(value / 100, { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const openRate = parseFloat(stats.openRate);
  const clickRate = parseFloat(stats.clickRate);
  const templateHref = template ? `/dashboard/marketing/templates/editor?id=${template.id}` : null;

  // ── Sections ──
  const funnel = stats.sent > 0 && (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("detail.funnelTitle")}</CardTitle>
        <CardDescription className="text-xs">{t("detail.funnelDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <FunnelBar
          icon={<Eye className="size-3.5 text-violet-500" aria-hidden />}
          label={t("openRate")}
          ratio={`${stats.opened}/${stats.sent}`}
          value={percent(openRate)}
          width={openRate}
          barClass="bg-violet-500"
        />
        <FunnelBar
          icon={<MousePointerClick className="size-3.5 text-green-500" aria-hidden />}
          label={t("clickRate")}
          ratio={`${stats.clicked}/${stats.sent}`}
          value={percent(clickRate)}
          width={clickRate}
          barClass="bg-green-500"
        />
        {stats.opened > 0 && (
          <FunnelBar
            icon={<MousePointerClick className="size-3.5 text-emerald-500" aria-hidden />}
            label={t("detail.clickToOpenRate")}
            ratio={`${stats.clicked}/${stats.opened}`}
            value={percent((stats.clicked / stats.opened) * 100)}
            width={(stats.clicked / stats.opened) * 100}
            barClass="bg-emerald-500"
          />
        )}

        {(stats.bounced > 0 || stats.unsubscribed > 0 || stats.complained > 0) && (
          <div className="flex flex-wrap gap-3 border-t pt-2 text-muted-foreground text-xs">
            {stats.bounced > 0 && (
              <span className="flex items-center gap-1">
                <AlertCircle className="size-3 text-amber-500" aria-hidden />
                {t("detail.bouncedCount", { count: stats.bounced })}
              </span>
            )}
            {stats.unsubscribed > 0 && (
              <span className="flex items-center gap-1">
                <UserMinus className="size-3 text-orange-500" aria-hidden />
                {t("detail.unsubscribedCount", { count: stats.unsubscribed })}
              </span>
            )}
            {stats.complained > 0 && (
              <span className="flex items-center gap-1">
                <AlertCircle className="size-3 text-red-500" aria-hidden />
                {t("detail.complaintsCount", { count: stats.complained })}
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );

  const sendLog = (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("detail.sendLogTitle")}</CardTitle>
        <CardDescription className="text-xs">{t("detail.sendLogDesc", { count: stats.total })}</CardDescription>
      </CardHeader>
      <CardContent>
        <CampaignLogTable logs={logs} total={stats.total} />
      </CardContent>
    </Card>
  );

  const content = (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-base">{tR("tabs.content")}</CardTitle>
        {templateHref && (
          <Link
            href={templateHref}
            className="inline-flex min-h-10 items-center text-primary text-sm hover:underline md:min-h-0"
          >
            {t("detail.openTemplate")}
          </Link>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {template ? (
          <>
            <FieldList>
              <Field label={t("launch.templateLabel")} always>
                {template.name}
              </Field>
              <Field label={tM("templates.subject")} always>
                <span className="font-medium">{template.subject}</span>
              </Field>
              <Field label={t("detail.previewTextLabel")}>{template.previewText}</Field>
            </FieldList>
            {/*
              ⚠️ `sandbox` with no permissions: the body is HTML a user wrote, and
              an iframe that allowed scripts or same-origin access would run it
              with this page's cookies. Fully sandboxed it is drawn and nothing
              else — which is all a preview is for.
            */}
            {template.isHtml ? (
              <iframe
                title={tM("emailBuilder.emailPreview")}
                srcDoc={template.body}
                sandbox=""
                referrerPolicy="no-referrer"
                className="h-[28rem] w-full rounded-md border bg-white"
              />
            ) : (
              <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/30 p-3 font-sans text-sm">
                {template.body}
              </pre>
            )}
          </>
        ) : (
          <EmptyHint>{t("launch.noTemplateWarning")}</EmptyHint>
        )}
      </CardContent>
    </Card>
  );

  const settings = (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{tR("detailsTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <FieldList>
          <Field label={t("columns.status")} always>
            {t(`statuses.${statusKey}`)}
          </Field>
          <Field label={t("launch.templateLabel")} always>
            {template && templateHref && (
              <Link href={templateHref} className="text-primary hover:underline">
                {template.name}
              </Link>
            )}
          </Field>
          {campaign.recipientType && (
            <>
              <Field label={t("launch.audienceLabel")}>
                {campaign.recipientType === "leads" ? t("launch.audienceLeads") : t("launch.audienceContacts")}
              </Field>
              <Field label={t("detail.segmentLabel")}>{segmentName}</Field>
            </>
          )}
          {campaign.status === "scheduled" && campaign.scheduledAt && (
            <Field label={t("scheduledAt")}>
              <FormattedDate date={campaign.scheduledAt} />
            </Field>
          )}
          <Field label={t("detail.trackingLabel")}>
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
              {t("detail.trackingBadge")}
            </span>
          </Field>
          <Field label={tR("created")}>
            <FormattedDate date={campaign.createdAt} />
          </Field>
          <Field label={tR("updated")}>
            <FormattedDate date={campaign.updatedAt} />
          </Field>
        </FieldList>
      </CardContent>
    </Card>
  );

  // A draft with nothing sent opens on what it will say; anything that has gone
  // out opens on who it went to.
  const contentFirst = stats.total === 0;
  const recipientsTab = {
    id: "recipients",
    label: tR("tabs.recipients"),
    icon: <UsersIcon aria-hidden />,
    count: stats.total,
  };
  const contentTab = { id: "content", label: tR("tabs.content"), icon: <FileTextIcon aria-hidden /> };
  const recipientSections = [
    ...(funnel ? [{ tab: "recipients", column: "main" as const, node: funnel }] : []),
    { tab: "recipients", column: "main" as const, node: sendLog },
  ];
  const contentSection = { tab: "content", column: "main" as const, node: content };

  return (
    <RecordPage>
      <RecordVisit type="campaign" id={campaign.id} label={campaign.name} />
      <RecordBackLink href="/dashboard/marketing/campaigns">{t("detail.back")}</RecordBackLink>

      {/* ── Hero: what it is, where it stands, and whether it can go ── */}
      <RecordHero
        badges={
          <>
            <StatusBadge tone={STATUS_TONE[statusKey]}>{t(`statuses.${statusKey}`)}</StatusBadge>
            <StatusBadge>
              <ShieldCheck aria-hidden />
              {t("detail.trackingBadge")}
            </StatusBadge>
          </>
        }
        title={campaign.name}
        meta={
          <>
            {template && (
              <MetaItem icon={<Mail aria-hidden />} href={templateHref}>
                {template.name}
              </MetaItem>
            )}
            {campaign.recipientType && <MetaItem icon={<UsersIcon aria-hidden />}>{segmentName}</MetaItem>}
            {campaign.status === "scheduled" && campaign.scheduledAt && (
              <MetaItem icon={<CalendarClock aria-hidden />}>
                <FormattedDate date={campaign.scheduledAt} />
              </MetaItem>
            )}
            <MetaItem icon={<Clock aria-hidden />}>
              {t("detail.created", {
                date: formatter.dateTime(new Date(campaign.createdAt), { dateStyle: "medium" }),
              })}
            </MetaItem>
          </>
        }
        actions={
          canWrite ? (
            <CampaignActions
              campaign={{
                id: campaign.id,
                name: campaign.name,
                description: campaign.description,
                status: campaign.status,
                templateId: campaign.templateId,
              }}
              templates={templates}
              templateName={template?.name}
            />
          ) : undefined
        }
      >
        {campaign.description && (
          <p className="whitespace-pre-wrap break-words text-muted-foreground text-sm">{campaign.description}</p>
        )}

        {/* The four figures a send is judged by. Sent, queued and failed fold into
            the recipients' hint: seven tiles was a report, not a header. */}
        <MetricStrip>
          <Metric
            label={tR("tabs.recipients")}
            hint={
              stats.total > 0
                ? t("detail.recipientsHint", { sent: stats.sent, queued: stats.queued, failed: stats.failed })
                : undefined
            }
          >
            {stats.total}
          </Metric>
          <Metric
            label={t("openRate")}
            hint={stats.sent > 0 ? t("detail.ofSent", { count: stats.opened, sent: stats.sent }) : undefined}
          >
            {stats.sent > 0 ? percent(openRate) : "—"}
          </Metric>
          <Metric
            label={t("clickRate")}
            hint={stats.sent > 0 ? t("detail.ofSent", { count: stats.clicked, sent: stats.sent }) : undefined}
          >
            {stats.sent > 0 ? percent(clickRate) : "—"}
          </Metric>
          <Metric
            label={t("bounced")}
            hint={stats.unsubscribed > 0 ? t("detail.unsubscribedCount", { count: stats.unsubscribed }) : undefined}
          >
            {stats.bounced}
          </Metric>
        </MetricStrip>
      </RecordHero>

      {/* One subject at a time on a phone; on a desktop the work column holds
          the results and the content, and the settings sit beside them. */}
      <RecordSections
        label={tR("sectionsLabel")}
        tabs={[
          ...(contentFirst ? [contentTab, recipientsTab] : [recipientsTab, contentTab]),
          { id: "settings", label: tR("tabs.settings"), icon: <InfoIcon aria-hidden /> },
        ]}
        sections={[
          ...(contentFirst ? [contentSection, ...recipientSections] : [...recipientSections, contentSection]),
          { tab: "settings", column: "side", node: settings },
        ]}
      />
    </RecordPage>
  );
}

/** One line of the funnel: the rate, the counts it is made of, and a bar. */
function FunnelBar({
  icon,
  label,
  ratio,
  value,
  width,
  barClass,
}: {
  icon: ReactNode;
  label: string;
  ratio: string;
  value: string;
  width: number;
  barClass: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
          {icon}
          <span className="truncate">{label}</span>
          <span className="shrink-0 text-[10px] tabular-nums">({ratio})</span>
        </span>
        <span className="shrink-0 font-semibold tabular-nums">{value}</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all ${barClass}`}
          style={{ width: `${Math.min(width, 100)}%` }}
        />
      </div>
    </div>
  );
}
