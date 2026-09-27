"use client";

import { useMemo, useState } from "react";

import Link from "next/link";

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

import { RecordCards, ResponsiveRecordList } from "@/components/crm/record-cards";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

/**
 * Rows drawn at first, and added per "show more". A campaign to five hundred
 * people used to be five hundred rows under the funnel — on a phone, five hundred
 * cards — while the filters and the search above them are how anybody finds one
 * recipient in practice.
 */
const PAGE = 10;
const MORE = 25;

/** The contact or lead a row went to, so a recipient is one tap from their record. */
const recipientHref = (log: LogRow) =>
  log.contactId ? `/dashboard/contacts/${log.contactId}` : log.leadId ? `/dashboard/leads/${log.leadId}` : undefined;

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  logs: LogRow[];
  total: number;
}

export function CampaignLogTable({ logs, total }: Props) {
  const t = useTranslations("marketing.campaigns.logTable");
  const tR = useTranslations("record");
  const formatter = useFormatter();
  const formatStamp = (d: Date | string) =>
    formatter.dateTime(new Date(d), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const [activeTab, setActiveTab] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(PAGE);
  // A new filter or search starts from the top of its own results.
  const chooseTab = (tab: string) => {
    setActiveTab(tab);
    setLimit(PAGE);
  };
  const changeSearch = (value: string) => {
    setSearch(value);
    setLimit(PAGE);
  };

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

  const shown = filtered.slice(0, limit);
  const remaining = filtered.length - shown.length;

  if (logs.length === 0) {
    return (
      <div className="py-14 text-center">
        <CheckCircle2 className="mx-auto mb-3 h-8 w-8 text-muted-foreground/30" />
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Tab bar */}
      <div className="flex items-center gap-1 overflow-x-auto border-b pb-0.5">
        {TABS.map((tab) => {
          const count = counts[tab] ?? 0;
          const isActive = activeTab === tab;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => chooseTab(tab)}
              aria-pressed={isActive}
              className={`-mb-px flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 font-medium text-sm transition-colors md:min-h-0 ${
                isActive
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
              }`}
            >
              {t(`tabs.${tab}`)}
              {count > 0 && (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] tabular-nums leading-none ${
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
        <Search className="-translate-y-1/2 absolute top-1/2 left-2.5 h-3.5 w-3.5 text-muted-foreground" />
        {/* 16px and 44px on a phone: smaller text makes iOS zoom the page on focus. */}
        <Input
          aria-label={t("searchPlaceholder")}
          placeholder={t("searchPlaceholder")}
          value={search}
          onChange={(e) => changeSearch(e.target.value)}
          className="h-11 pl-8 text-base md:h-8 md:text-sm"
        />
      </div>

      {/* Table */}
      {/* Below `md` the rows are cards: six columns of recipient, type, status and
          three timestamps do not fit a phone, and scrolling sideways loses the
          recipient the row is about. */}
      {filtered.length === 0 ? (
        <p className="py-8 text-center text-muted-foreground text-sm">{t("noResults")}</p>
      ) : (
        <ResponsiveRecordList
          cards={
            <RecordCards
              items={shown.map((log) => {
                const statusKey = log.status in STATUS_CONFIG ? log.status : "sent";
                const cfg = STATUS_CONFIG[statusKey];
                const StatusIcon = cfg.icon;
                return {
                  id: log.id,
                  href: recipientHref(log),
                  title: log.recipientName,
                  subtitle: log.recipientEmail,
                  badge: (
                    <Badge variant="outline" className={`gap-1 text-xs ${cfg.className}`}>
                      <StatusIcon className="h-3 w-3" />
                      {t(`statuses.${statusKey}`)}
                    </Badge>
                  ),
                  meta: (
                    <>
                      {log.recipientType && (
                        <Badge variant="outline" className="h-4 px-1.5 py-0 text-[10px] capitalize">
                          {t(`recipientTypes.${log.recipientType}`)}
                        </Badge>
                      )}
                      <span className="flex items-center gap-1 text-muted-foreground text-xs">
                        <Send className="h-3 w-3" />
                        {formatStamp(log.sentAt)}
                      </span>
                      {log.openedAt && (
                        <span className="flex items-center gap-1 font-medium text-violet-600 text-xs">
                          <Eye className="h-3 w-3" />
                          {formatStamp(log.openedAt)}
                        </span>
                      )}
                      {log.clickedAt && (
                        <span className="flex items-center gap-1 font-medium text-green-600 text-xs">
                          <MousePointerClick className="h-3 w-3" />
                          {formatStamp(log.clickedAt)}
                        </span>
                      )}
                      {log.errorMessage && (
                        <p className="w-full truncate text-[10px] text-red-600" title={log.errorMessage}>
                          {log.errorMessage}
                        </p>
                      )}
                    </>
                  ),
                };
              })}
            />
          }
          table={
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="font-semibold text-xs">{t("columns.recipient")}</TableHead>
                  <TableHead className="font-semibold text-xs">{t("columns.type")}</TableHead>
                  <TableHead className="font-semibold text-xs">{t("columns.status")}</TableHead>
                  <TableHead className="font-semibold text-xs">{t("columns.sentAt")}</TableHead>
                  <TableHead className="font-semibold text-xs">{t("columns.opened")}</TableHead>
                  <TableHead className="font-semibold text-xs">{t("columns.clicked")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((log) => {
                  const statusKey = log.status in STATUS_CONFIG ? log.status : "sent";
                  const cfg = STATUS_CONFIG[statusKey];
                  const StatusIcon = cfg.icon;
                  const href = recipientHref(log);
                  return (
                    <TableRow key={log.id}>
                      <TableCell>
                        {href ? (
                          <Link href={href} className="font-medium text-sm leading-none hover:underline">
                            {log.recipientName}
                          </Link>
                        ) : (
                          <p className="font-medium text-sm leading-none">{log.recipientName}</p>
                        )}
                        <p className="mt-0.5 text-muted-foreground text-xs">{log.recipientEmail}</p>
                      </TableCell>
                      <TableCell>
                        {log.recipientType ? (
                          <Badge variant="outline" className="h-4 px-1.5 py-0 text-[10px] capitalize">
                            {t(`recipientTypes.${log.recipientType}`)}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`gap-1 text-xs ${cfg.className}`}>
                          <StatusIcon className="h-3 w-3" />
                          {t(`statuses.${statusKey}`)}
                        </Badge>
                        {log.errorMessage && (
                          <p
                            className="mt-0.5 max-w-[160px] truncate text-[10px] text-red-600"
                            title={log.errorMessage}
                          >
                            {log.errorMessage}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">{formatStamp(log.sentAt)}</TableCell>
                      <TableCell className="text-xs">
                        {log.openedAt ? (
                          <span className="font-medium text-violet-600">{formatStamp(log.openedAt)}</span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        {log.clickedAt ? (
                          <span className="font-medium text-green-600">{formatStamp(log.clickedAt)}</span>
                        ) : (
                          "—"
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
      )}

      <p className="text-right text-[11px] text-muted-foreground">{t("showing", { shown: shown.length, total })}</p>
    </div>
  );
}
