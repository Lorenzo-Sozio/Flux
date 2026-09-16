import Link from "next/link";
import { notFound } from "next/navigation";

import { ChevronLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { getEmailTemplates } from "@/actions/marketing";
import { getSequence } from "@/actions/sequences";
import { RecordVisit } from "@/components/crm/record-visit";
import { getActor } from "@/lib/auth-guard";
import { requirePageCapability } from "@/lib/page-guard";
import { can } from "@/lib/permissions";

import { EnrollmentsTable } from "./_components/enrollments-table";
import { SequenceEditor } from "./_components/sequence-editor";

export default async function SequencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePageCapability("record:read", `/dashboard/marketing/sequences/${id}`);
  const isNew = id === "new";

  const [data, templates, actor, t] = await Promise.all([
    isNew ? Promise.resolve(null) : getSequence(id),
    getEmailTemplates().catch(() => []),
    getActor(),
    getTranslations("sequences"),
  ]);
  if (!isNew && !data) notFound();

  return (
    <div className="space-y-6">
      {data && <RecordVisit type="sequence" id={data.sequence.id} label={data.sequence.name} />}
      <div className="min-w-0">
        <Link
          href="/dashboard/marketing/sequences"
          className="mb-3 inline-flex items-center gap-1 text-muted-foreground text-sm transition-colors hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          {t("back")}
        </Link>
        <h1 className="font-bold text-2xl tracking-tight">{data?.sequence.name ?? t("newSequence")}</h1>
      </div>

      <SequenceEditor
        sequence={data?.sequence ?? null}
        steps={data?.steps ?? []}
        templates={templates.map((tpl) => ({ id: tpl.id, name: tpl.name, subject: tpl.subject, body: tpl.body }))}
        canManage={can(actor, "sequence:manage")}
      />

      {data && (
        <EnrollmentsTable
          enrollments={data.enrollments}
          stepCount={data.steps.length}
          canWrite={can(actor, "record:write")}
        />
      )}
    </div>
  );
}
