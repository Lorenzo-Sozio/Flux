import Link from "next/link";

import { AlertTriangle, Plus } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { getSequences, replyDetectionConfigured } from "@/actions/sequences";
import { RecordCards, ResponsiveRecordList } from "@/components/crm/record-cards";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getActor } from "@/lib/auth-guard";
import { requirePageCapability } from "@/lib/page-guard";
import { can } from "@/lib/permissions";

export default async function SequencesPage() {
  await requirePageCapability("record:read", "/dashboard/marketing/sequences");
  const [sequences, replies, actor, t] = await Promise.all([
    getSequences(),
    replyDetectionConfigured(),
    getActor(),
    getTranslations("sequences"),
  ]);
  const canManage = can(actor, "sequence:manage");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-bold text-2xl tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
        </div>
        {canManage && (
          <Button asChild className="gap-2">
            <Link href="/dashboard/marketing/sequences/new">
              <Plus className="h-4 w-4" />
              {t("newSequence")}
            </Link>
          </Button>
        )}
      </div>

      {!replies && (
        <Card className="border-amber-300 dark:border-amber-800">
          <CardContent className="flex gap-3 p-4 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div className="min-w-0">
              <p className="font-medium">{t("noReplyDetectionTitle")}</p>
              <p className="text-muted-foreground">{t("noReplyDetectionBody")}</p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {sequences.length === 0 ? (
            <p className="py-12 text-center text-muted-foreground text-sm">{t("empty")}</p>
          ) : (
            // Below `md` the rows are cards: seven columns, five of them counts,
            // leave the name a word wide on a phone.
            <ResponsiveRecordList
              cards={
                <RecordCards
                  className="p-2"
                  items={sequences.map((s) => ({
                    id: s.id,
                    href: `/dashboard/marketing/sequences/${s.id}`,
                    title: s.name,
                    subtitle: t(`entity.${s.entityType as "lead" | "contact"}`),
                    badge: !s.isActive ? (
                      <Badge variant="outline" className="text-[10px]">
                        {t("paused")}
                      </Badge>
                    ) : undefined,
                    meta: [
                      { label: t("steps"), value: s.stepCount },
                      { label: t("inProgress"), value: s.active },
                      { label: t("completed"), value: s.completed },
                      { label: t("replied"), value: s.replied },
                      { label: t("stoppedOther"), value: s.stopped - s.replied },
                    ].map((m) => (
                      <span key={m.label} className="text-muted-foreground text-xs">
                        {m.label} <span className="font-medium text-foreground tabular-nums">{m.value}</span>
                      </span>
                    )),
                  }))}
                />
              }
              table={
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("name")}</TableHead>
                      <TableHead>{t("for")}</TableHead>
                      <TableHead className="text-right">{t("steps")}</TableHead>
                      <TableHead className="text-right">{t("inProgress")}</TableHead>
                      <TableHead className="text-right">{t("completed")}</TableHead>
                      <TableHead className="text-right">{t("replied")}</TableHead>
                      <TableHead className="text-right">{t("stoppedOther")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sequences.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell>
                          <Link href={`/dashboard/marketing/sequences/${s.id}`} className="font-medium hover:underline">
                            {s.name}
                          </Link>
                          {!s.isActive && (
                            <Badge variant="outline" className="ml-2 text-[10px]">
                              {t("paused")}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>{t(`entity.${s.entityType as "lead" | "contact"}`)}</TableCell>
                        <TableCell className="text-right tabular-nums">{s.stepCount}</TableCell>
                        <TableCell className="text-right tabular-nums">{s.active}</TableCell>
                        <TableCell className="text-right tabular-nums">{s.completed}</TableCell>
                        <TableCell className="text-right tabular-nums">{s.replied}</TableCell>
                        <TableCell className="text-right tabular-nums">{s.stopped - s.replied}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              }
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
