"use client";

import { format } from "date-fns";
import { AlertCircle, CheckCircle2, Eye, Mail, MousePointerClick } from "lucide-react";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const STATUS_CLASS: Record<string, string> = {
  sent: "border-blue-300   text-blue-700   bg-blue-50",
  opened: "border-violet-300 text-violet-700 bg-violet-50",
  clicked: "border-green-300  text-green-700  bg-green-50",
  failed: "border-red-400    text-red-800    bg-red-50",
};

interface EmailLog {
  id: string;
  status: string;
  sentAt: Date;
  openedAt: Date | null;
  clickedAt: Date | null;
  errorMessage: string | null;
  recipientName: string;
  recipientEmail: string;
  recipientType: string | null;
}

interface Props {
  logs: EmailLog[];
}

export function AutomationEmailLogs({ logs }: Props) {
  const t = useTranslations("automation.emailLogs");

  const total = logs.length;
  const sent = logs.filter((l) => l.status !== "failed").length;
  const opened = logs.filter((l) => ["opened", "clicked"].includes(l.status)).length;
  const clicked = logs.filter((l) => l.status === "clicked").length;
  const failed = logs.filter((l) => l.status === "failed").length;

  const openRate = sent > 0 ? ((opened / sent) * 100).toFixed(1) : "0";
  const clickRate = sent > 0 ? ((clicked / sent) * 100).toFixed(1) : "0";

  const statusLabels: Record<string, string> = {
    sent: t("statusSent"),
    opened: t("statusOpened"),
    clicked: t("statusClicked"),
    failed: t("statusFailed"),
  };

  return (
    <div className="space-y-4">
      {/* Mini stats row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: t("statusSent"), value: sent, icon: Mail, color: "text-blue-500" },
          { label: t("openedWithRate", { rate: openRate }), value: opened, icon: Eye, color: "text-violet-500" },
          {
            label: t("clickedWithRate", { rate: clickRate }),
            value: clicked,
            icon: MousePointerClick,
            color: "text-green-500",
          },
          { label: t("statusFailed"), value: failed, icon: AlertCircle, color: "text-red-500" },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label} className="border shadow-none">
            <CardContent className="flex items-center gap-3 pt-4 pb-3">
              <Icon className={`h-5 w-5 shrink-0 ${color}`} />
              <div>
                <p className="font-bold text-lg tabular-nums leading-none">{value}</p>
                <p className="mt-0.5 text-muted-foreground text-xs">{label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Log table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 font-semibold text-sm">
            <Mail className="h-4 w-4 text-emerald-500" />
            {t("cardTitle")}
          </CardTitle>
          <CardDescription className="text-xs">{t("cardDesc", { total })}</CardDescription>
        </CardHeader>

        {logs.length === 0 ? (
          <CardContent className="py-10 text-center">
            <CheckCircle2 className="mx-auto mb-3 h-8 w-8 text-muted-foreground/30" />
            <p className="text-muted-foreground text-sm">{t("noEmailsYet")}</p>
            <p className="mt-1 text-muted-foreground text-xs">{t("noEmailsDesc")}</p>
          </CardContent>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="font-semibold text-xs">{t("colRecipient")}</TableHead>
                <TableHead className="font-semibold text-xs">{t("colType")}</TableHead>
                <TableHead className="font-semibold text-xs">{t("colStatus")}</TableHead>
                <TableHead className="font-semibold text-xs">{t("colSentAt")}</TableHead>
                <TableHead className="font-semibold text-xs">{t("colOpened")}</TableHead>
                <TableHead className="font-semibold text-xs">{t("colClicked")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log) => {
                const statusClass = STATUS_CLASS[log.status] ?? STATUS_CLASS.sent;
                const statusLabel = statusLabels[log.status] ?? log.status;
                return (
                  <TableRow key={log.id}>
                    <TableCell className="text-sm">
                      <p className="font-medium leading-none">{log.recipientName}</p>
                      <p className="mt-0.5 text-muted-foreground text-xs">{log.recipientEmail}</p>
                    </TableCell>
                    <TableCell>
                      {log.recipientType ? (
                        <Badge variant="outline" className="h-4 px-1.5 py-0 text-[10px] capitalize">
                          {log.recipientType}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-xs ${statusClass}`}>
                        {statusLabel}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {format(new Date(log.sentAt), "MMM d, HH:mm")}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {log.openedAt ? (
                        <span className="font-medium text-violet-600">
                          {format(new Date(log.openedAt), "MMM d, HH:mm")}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {log.clickedAt ? (
                        <span className="font-medium text-green-600">
                          {format(new Date(log.clickedAt), "MMM d, HH:mm")}
                        </span>
                      ) : (
                        "—"
                      )}
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
