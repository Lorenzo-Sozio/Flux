"use client";

import { useMemo, useState } from "react";

import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Eye,
  MessageCircleWarning,
  MousePointerClick,
  Search,
  Send,
  UserMinus,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LogRow {
  id: string;
  status: string;
  sentAt: Date;
  openedAt: Date | null;
  clickedAt: Date | null;
  errorMessage: string | null;
  contactId: string | null;
  leadId: string | null;
  recipientName: string;
  recipientEmail: string;
  recipientType: "contact" | "lead" | null;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { className: string; icon: React.ElementType }> = {
  queued: { className: "border-slate-300  text-slate-600", icon: Clock },
  sent: { className: "border-blue-300   text-blue-700   bg-blue-50", icon: Send },
  opened: { className: "border-violet-300 text-violet-700 bg-violet-50", icon: Eye },
  clicked: { className: "border-green-300  text-green-700  bg-green-50", icon: MousePointerClick },
  bounced: { className: "border-amber-300  text-amber-700  bg-amber-50", icon: AlertCircle },
  complained: {
    className: "border-red-300    text-red-700    bg-red-50",
    icon: MessageCircleWarning,
  },
  unsubscribed: { className: "border-orange-300 text-orange-700 bg-orange-50", icon: UserMinus },
  failed: { className: "border-red-400    text-red-800    bg-red-50", icon: AlertCircle },
};

/** Tab values; the label is `tabs.<value>` in marketing.campaigns.logTable. */
const TABS = ["all", "sent", "opened", "clicked", "bounced", "unsubscribed", "failed"] as const;

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  logs: LogRow[];
  total: number;
}

export function CampaignLogTable({ logs, total }: Props) {
  const t = useTranslations("marketing.campaigns.logTable");
  const formatter = useFormatter();
  const formatStamp = (d: Date | string) =>
    formatter.dateTime(new Date(d), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const [activeTab, setActiveTab] = useState<string>("all");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    let rows = logs;
    if (activeTab !== "all") {
      if (activeTab === "opened") {
        rows = rows.filter((r) => ["opened", "clicked"].includes(r.status));
      } else {
        rows = rows.filter((r) => r.status === activeTab);
      }
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (r) => r.recipientName.toLowerCase().includes(q) || r.recipientEmail.toLowerCase().includes(q),
      );
    }
    return rows;
  }, [logs, activeTab, search]);

  // Tab counts
  const counts = useMemo(() => {
    const map: Record<string, number> = { all: logs.length };
    for (const l of logs) {
      map[l.status] = (map[l.status] ?? 0) + 1;
    }
    // "opened" tab = opened + clicked
    map.opened = (map.opened ?? 0) + (map.clicked ?? 0);
    return map;
  }, [logs]);

  if (logs.length === 0) {
    return (
      <div className="py-14 text-center">
        <CheckCircle2 className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Tab bar */}
      <div className="flex items-center gap-1 overflow-x-auto pb-0.5 border-b">
        {TABS.map((tab) => {
          const count = counts[tab] ?? 0;
          const isActive = activeTab === tab;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`flex items-center gap-1.5 whitespace-nowrap px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                isActive
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
              }`}
            >
              {t(`tabs.${tab}`)}
              {count > 0 && (
                <span
                  className={`text-[10px] tabular-nums rounded-full px-1.5 py-0.5 leading-none ${
                    isActive ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder={t("searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8 h-8 text-sm"
        />
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-8">{t("noResults")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="text-xs font-semibold">{t("columns.recipient")}</TableHead>
              <TableHead className="text-xs font-semibold">{t("columns.type")}</TableHead>
              <TableHead className="text-xs font-semibold">{t("columns.status")}</TableHead>
              <TableHead className="text-xs font-semibold">{t("columns.sentAt")}</TableHead>
              <TableHead className="text-xs font-semibold">{t("columns.opened")}</TableHead>
              <TableHead className="text-xs font-semibold">{t("columns.clicked")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((log) => {
              const statusKey = log.status in STATUS_CONFIG ? log.status : "sent";
              const cfg = STATUS_CONFIG[statusKey];
              const StatusIcon = cfg.icon;
              return (
                <TableRow key={log.id}>
                  <TableCell>
                    <p className="text-sm font-medium leading-none">{log.recipientName}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{log.recipientEmail}</p>
                  </TableCell>
                  <TableCell>
                    {log.recipientType ? (
                      <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-4 capitalize">
                        {t(`recipientTypes.${log.recipientType}`)}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-xs gap-1 ${cfg.className}`}>
                      <StatusIcon className="h-3 w-3" />
                      {t(`statuses.${statusKey}`)}
                    </Badge>
                    {log.errorMessage && (
                      <p className="text-[10px] text-red-600 mt-0.5 max-w-[160px] truncate" title={log.errorMessage}>
                        {log.errorMessage}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatStamp(log.sentAt)}</TableCell>
                  <TableCell className="text-xs">
                    {log.openedAt ? (
                      <span className="text-violet-600 font-medium">{formatStamp(log.openedAt)}</span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    {log.clickedAt ? (
                      <span className="text-green-600 font-medium">{formatStamp(log.clickedAt)}</span>
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

      <p className="text-[11px] text-muted-foreground text-right">{t("showing", { shown: filtered.length, total })}</p>
    </div>
  );
}
