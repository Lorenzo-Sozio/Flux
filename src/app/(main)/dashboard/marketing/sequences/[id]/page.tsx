import { notFound } from "next/navigation";

import { AlertTriangle, ChevronDown, ListOrderedIcon, UsersIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { getEmailTemplates } from "@/actions/marketing";
import { getSequence, getSequences, replyDetectionConfigured } from "@/actions/sequences";
import {
  MetaItem,
  Metric,
  MetricStrip,
  RecordBackLink,
  RecordHero,
  RecordPage,
  StatusBadge,
} from "@/components/crm/record/record-page";
import { RecordVisit } from "@/components/crm/record-visit";
import { Card, CardContent } from "@/components/ui/card";
import { getActor } from "@/lib/auth-guard";
import { requirePageCapability } from "@/lib/page-guard";
import { can } from "@/lib/permissions";

import { EnrollmentsTable } from "./_components/enrollments-table";
import { SequenceEditor } from "./_components/sequence-editor";

/**
 * One follow-up sequence: whether it is sending, how far the people on it have
 * got, and — below — its steps, the people, and its settings.
 *
 * ⚠️ The figures come from the same grouped count as the list, not from the rows
 * this page draws: those stop at five hundred, and a sequence past that would have
 * shown a total that stopped growing while people kept being enrolled.
 */
export default async function SequencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePageCapability("record:read", `/dashboard/marketing/sequences/${id}`);
  const isNew = id === "new";

  const [data, templates, actor, replies, overview, t, tR] = await Promise.all([
    isNew ? Promise.resolve(null) : getSequence(id),
    getEmailTemplates().catch(() => []),
    getActor(),
    replyDetectionConfigured(),
    isNew ? Promise.resolve([]) : getSequences().catch(() => []),
    getTranslations("sequences"),
    getTranslations("record"),
  ]);
  if (!isNew && !data) notFound();

  const counts = data
    ? (overview.find((s) => s.id === data.sequence.id) ?? {
        active: data.enrollments.filter((e) => e.status === "active").length,
        completed: data.enrollments.filter((e) => e.status === "completed").length,
        replied: data.enrollments.filter((e) => e.stopReason === "replied").length,
        stopped: data.enrollments.filter((e) => e.status === "stopped").length,
      })
    : null;
  const enrolled = counts ? counts.active + counts.completed + counts.stopped : 0;

  return (
    <RecordPage>
      {data && <RecordVisit type="sequence" id={data.sequence.id} label={data.sequence.name} />}
      <RecordBackLink href="/dashboard/marketing/sequences">{t("back")}</RecordBackLink>

      {/* ── Hero: what it is, whether it is sending, how far people have got ── */}
      <RecordHero
        badges={
          data && (
            <StatusBadge tone={data.sequence.isActive ? "success" : "warning"}>
              {data.sequence.isActive ? t("detail.active") : t("detail.paused")}
            </StatusBadge>
          )
        }
        title={data?.sequence.name ?? t("newSequence")}
        meta={
          data && (
            <>
              <MetaItem icon={<UsersIcon aria-hidden />}>
                {t("detail.forEntity", { entity: data.sequence.entityType })}
              </MetaItem>
              <MetaItem icon={<ListOrderedIcon aria-hidden />}>
                {t("detail.stepCount", { count: data.steps.length })}
              </MetaItem>
            </>
          )
        }
      >
        {data?.sequence.description && (
          <p className="whitespace-pre-wrap break-words text-muted-foreground text-sm">{data.sequence.description}</p>
        )}
        {counts && (
          <MetricStrip>
            <Metric label={tR("tabs.enrollments")}>{enrolled}</Metric>
            <Metric label={t("inProgress")}>{counts.active}</Metric>
            {/* Without inbound email nobody can reply as far as this knows, so the
                zero is said to be a blind spot rather than good news. */}
            <Metric label={t("replied")} hint={replies ? undefined : t("noReplyDetectionTitle")}>
              {replies ? counts.replied : "—"}
            </Metric>
            <Metric label={t("completed")}>{counts.completed}</Metric>
          </MetricStrip>
        )}
      </RecordHero>

      {/*
        ⚠️ Outside the tabs, on every one of them: a sequence that cannot see
        replies keeps writing to people who answered, and that is the one thing
        about it somebody editing a step must not miss. See CLAUDE.md, "Follow-up
        sequences".
      */}
      {!replies && (
        <Card className="py-0 ring-amber-300 sm:py-0 dark:ring-amber-800">
          {/* The warning itself always shows; the explanation opens on a tap. As a
              full paragraph it was half a phone screen above every tab. */}
          <CardContent className="p-0 text-sm">
            <details className="group/notice p-4">
              <summary className="flex min-h-6 cursor-pointer list-none gap-3 [&::-webkit-details-marker]:hidden">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
                <span className="min-w-0 flex-1 font-medium">{t("noReplyDetectionTitle")}</span>
                <ChevronDown
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-open/notice:rotate-180"
                  aria-hidden
                />
              </summary>
              <p className="mt-1 pl-7 text-muted-foreground">{t("noReplyDetectionBody")}</p>
            </details>
          </CardContent>
        </Card>
      )}

      <SequenceEditor
        sequence={data?.sequence ?? null}
        steps={data?.steps ?? []}
        templates={templates.map((tpl) => ({ id: tpl.id, name: tpl.name, subject: tpl.subject, body: tpl.body }))}
        canManage={can(actor, "sequence:manage")}
        enrolledCount={enrolled}
        enrollments={
          data ? (
            <EnrollmentsTable
              enrollments={data.enrollments}
              stepCount={data.steps.length}
              canWrite={can(actor, "record:write")}
            />
          ) : undefined
        }
      />
    </RecordPage>
  );
}
