"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";

import { stopEnrollment } from "@/actions/sequences";
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
  const locale = useLocale();
  const router = useRouter();
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
              {enrollments.map((e) => {
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
        )}
      </CardContent>
    </Card>
  );
}
