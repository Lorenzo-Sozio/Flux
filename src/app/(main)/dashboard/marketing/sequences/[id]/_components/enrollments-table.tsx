"use client";

import { useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";

import { stopEnrollment } from "@/actions/sequences";
import { RecordCards, ResponsiveRecordList } from "@/components/crm/record-cards";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Enrollment {
  id: string;
  email: string;
  status: string;
  stopReason: string | null;
  nextStep: number;
  nextSendAt: Date | null;
  lastSentAt: Date | null;
  leadId: string | null;
  contactId: string | null;
  leadFirst: string | null;
  leadLast: string | null;
  contactFirst: string | null;
  contactLast: string | null;
}

const PAGE = 10;
const MORE = 25;

export function EnrollmentsTable({
  enrollments,
  stepCount,
  canWrite,
}: {
  enrollments: Enrollment[];
  stepCount: number;
  canWrite: boolean;
}) {
  const t = useTranslations("sequences");
  const tR = useTranslations("record");
  const locale = useLocale();
  const router = useRouter();
  // Up to five hundred people come back from the server; ten are drawn at first,
  // the most recently enrolled, and more on request.
  const [limit, setLimit] = useState(PAGE);
  const shown = enrollments.slice(0, limit);
  const remaining = enrollments.length - shown.length;
  const when = (d: Date | null) =>
    d ? new Date(d).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" }) : "—";

  const stop = async (id: string) => {
    await stopEnrollment(id);
    toast.success(t("stoppedToast"));
    router.refresh();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("enrolled", { count: enrollments.length })}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {enrollments.length === 0 ? (
          <p className="px-6 pb-6 text-muted-foreground text-sm">{t("noEnrollments")}</p>
        ) : (
          // Below `md` the rows are cards: two timestamps and a progress column
          // beside the recipient do not fit a phone, and the stop button went
          // past the edge of the screen.
          <ResponsiveRecordList
            cards={
              <RecordCards
                className="px-3 pb-3"
                items={shown.map((e) => {
                  const href = e.leadId ? `/dashboard/leads/${e.leadId}` : `/dashboard/contacts/${e.contactId}`;
                  const name = [e.leadFirst ?? e.contactFirst, e.leadLast ?? e.contactLast].filter(Boolean).join(" ");
                  return {
                    id: e.id,
                    href,
                    title: name || e.email,
                    subtitle: name ? e.email : undefined,
                    badge: (
                      <Badge variant="outline">
                        {e.status === "stopped" && e.stopReason
                          ? t(`reasons.${e.stopReason}` as "reasons.manual")
                          : t(`statuses.${e.status}` as "statuses.active")}
                      </Badge>
                    ),
                    fields: [
                      { label: t("progress"), value: `${Math.min(e.nextStep, stepCount)} / ${stepCount}` },
                      { label: t("lastSent"), value: when(e.lastSentAt) },
                      { label: t("nextSend"), value: e.status === "active" ? when(e.nextSendAt) : null },
                    ],
                    footer:
                      canWrite && e.status === "active" ? (
                        <Button variant="outline" size="sm" className="ml-auto" onClick={() => stop(e.id)}>
                          {t("stop")}
                        </Button>
                      ) : undefined,
                  };
                })}
              />
            }
            table={
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("recipient")}</TableHead>
                    <TableHead>{t("status")}</TableHead>
                    <TableHead>{t("progress")}</TableHead>
                    <TableHead>{t("lastSent")}</TableHead>
                    <TableHead>{t("nextSend")}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((e) => {
                    const href = e.leadId ? `/dashboard/leads/${e.leadId}` : `/dashboard/contacts/${e.contactId}`;
                    const name = [e.leadFirst ?? e.contactFirst, e.leadLast ?? e.contactLast].filter(Boolean).join(" ");
                    return (
                      <TableRow key={e.id}>
                        <TableCell className="min-w-0">
                          <Link href={href} className="font-medium hover:underline">
                            {name || e.email}
                          </Link>
                          <p className="text-muted-foreground text-xs">{e.email}</p>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {e.status === "stopped" && e.stopReason
                              ? t(`reasons.${e.stopReason}` as "reasons.manual")
                              : t(`statuses.${e.status}` as "statuses.active")}
                          </Badge>
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {Math.min(e.nextStep, stepCount)} / {stepCount}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{when(e.lastSentAt)}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          {e.status === "active" ? when(e.nextSendAt) : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          {canWrite && e.status === "active" && (
                            <Button variant="ghost" size="sm" onClick={() => stop(e.id)}>
                              {t("stop")}
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            }
          />
        )}
        {remaining > 0 && (
          <div className="px-3 pb-3 md:px-6 md:pb-6">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full max-md:h-11"
              onClick={() => setLimit((n) => n + MORE)}
            >
              {tR("showMore")}
              <span className="text-muted-foreground tabular-nums">+{Math.min(remaining, MORE)}</span>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
