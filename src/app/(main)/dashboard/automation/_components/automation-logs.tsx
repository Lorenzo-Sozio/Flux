"use client";

import { Fragment, useMemo, useState } from "react";

import { formatDistanceToNow } from "date-fns";
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, Clock, RotateCw } from "lucide-react";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface AutomationLog {
  id: string;
  ruleId: string;
  ruleName?: string;
  entityType: string;
  entityId: string;
  event: string;
  success: boolean;
  actionsExecuted: number;
  errorMessage: string | null;
  loopDetected?: boolean;
  loopInfo?: string | null;
  retryCount?: number;
  retryInfo?: string | null;
  createdAt: Date;
}

interface AutomationLogsProps {
  logs: AutomationLog[];
  rules?: { id: string; name: string }[];
  limit?: number;
}

export function AutomationLogs({ logs, rules = [], limit = 20 }: AutomationLogsProps) {
  const t = useTranslations("automation");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const displayLogs = useMemo(() => {
    // Enrich logs with rule names
    const enriched = logs.map((log) => ({
      ...log,
      ruleName: log.ruleName || rules.find((r) => r.id === log.ruleId)?.name || "Unknown Rule",
    }));
    return enriched.slice(0, limit);
  }, [logs, rules, limit]);

  if (displayLogs.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-muted-foreground" />
            {t("logs.recentExecutions")}
          </CardTitle>
          <CardDescription>{t("logs.noHistory")}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-muted-foreground" />
          {t("logs.recentExecutions")}
        </CardTitle>
        <CardDescription>{t("logs.lastRuns", { count: displayLogs.length })}</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow className="border-muted/50">
              <TableHead className="w-6" />
              <TableHead className="w-12">{t("logs.statusCol")}</TableHead>
              <TableHead>{t("logs.ruleCol")}</TableHead>
              <TableHead>{t("logs.entityCol")}</TableHead>
              <TableHead className="w-20 text-center">{t("logs.actionsCol")}</TableHead>
              <TableHead className="text-right">{t("logs.timeCol")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayLogs.map((log) => {
              const loopInfo = log.loopInfo ? JSON.parse(log.loopInfo) : null;
              const retryInfo = log.retryInfo ? JSON.parse(log.retryInfo) : null;
              const isExpanded = expandedId === log.id;

              return (
                <Fragment key={log.id}>
                  <TableRow
                    className="cursor-pointer border-muted/50 hover:bg-muted/30"
                    onClick={() => setExpandedId(isExpanded ? null : log.id)}
                  >
                    {/* Expand button */}
                    <TableCell className="w-6">
                      {((log.loopDetected ?? false) || (log.retryCount ?? 0) > 0) && (
                        <button type="button" className="rounded p-1 transition-colors hover:bg-muted">
                          <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                        </button>
                      )}
                    </TableCell>

                    {/* Status */}
                    <TableCell>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex items-center justify-center">
                              {log.success ? (
                                <div className="flex h-6 w-6 items-center justify-center rounded bg-green-100/80 dark:bg-green-900/30">
                                  <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                                </div>
                              ) : (
                                <div className="flex h-6 w-6 items-center justify-center rounded bg-red-100/80 dark:bg-red-900/30">
                                  <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
                                </div>
                              )}
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            {log.success ? t("logs.successTooltip") : log.errorMessage || "Failed"}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </TableCell>

                    {/* Rule Name */}
                    <TableCell>
                      <span className="font-medium text-sm">{log.ruleName}</span>
                    </TableCell>

                    {/* Entity */}
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {log.entityType} <span className="ml-1 opacity-60">#{log.entityId.slice(0, 8)}</span>
                      </Badge>
                    </TableCell>

                    {/* Actions Count */}
                    <TableCell className="text-center">
                      {log.success ? (
                        <Badge variant="secondary" className="text-xs">
                          {t("logs.actionCount", { count: log.actionsExecuted })}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground text-xs">
                          —
                        </Badge>
                      )}
                    </TableCell>

                    {/* Time */}
                    <TableCell className="text-right text-muted-foreground text-xs">
                      {formatDistanceToNow(new Date(log.createdAt), { addSuffix: true })}
                    </TableCell>
                  </TableRow>

                  {/* Expanded Row: Details */}
                  {isExpanded && ((loopInfo ?? false) || (retryInfo ?? false)) && (
                    <TableRow className="border-muted/50 bg-muted/20 hover:bg-muted/20">
                      <TableCell colSpan={6}>
                        <div className="space-y-3 py-3">
                          {/* Loop Detection Details */}
                          {(log.loopDetected ?? false) && loopInfo && (
                            <div className="flex items-start gap-3 rounded border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/20">
                              <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600 dark:text-amber-400" />
                              <div className="min-w-0 flex-1">
                                <p className="mb-2 font-semibold text-amber-900 text-xs dark:text-amber-100">
                                  🔄 {t("logs.loopDetection")}
                                </p>
                                <div className="space-y-1 text-amber-800 text-xs dark:text-amber-300">
                                  <p>
                                    <strong>{t("logs.depth")}:</strong> {loopInfo.depth || 0}
                                  </p>
                                  {loopInfo.triggeredRules && loopInfo.triggeredRules.length > 0 && (
                                    <p>
                                      <strong>{t("logs.triggeredRules")}:</strong> {loopInfo.triggeredRules.join(", ")}
                                    </p>
                                  )}
                                  {loopInfo.chain && loopInfo.chain.length > 0 && (
                                    <p>
                                      <strong>{t("logs.chain")}:</strong> {loopInfo.chain.join(" → ")}
                                    </p>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Retry Details */}
                          {(log.retryCount ?? 0) > 0 && retryInfo && (
                            <div className="flex items-start gap-3 rounded border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950/20">
                              <RotateCw className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-600 dark:text-blue-400" />
                              <div className="min-w-0 flex-1">
                                <p className="mb-2 font-semibold text-blue-900 text-xs dark:text-blue-100">
                                  🔁 {t("logs.retryAttempts")}
                                </p>
                                <div className="space-y-1 text-blue-800 text-xs dark:text-blue-300">
                                  <p>
                                    <strong>{t("logs.attempts")}:</strong> {retryInfo.attempts || log.retryCount} /{" "}
                                    {retryInfo.maxAttempts || 3}
                                  </p>
                                  {retryInfo.exponentialBackoff && (
                                    <p>
                                      <strong>{t("logs.strategy")}:</strong> {t("logs.exponentialBackoff")}
                                    </p>
                                  )}
                                  {retryInfo.lastError && (
                                    <p>
                                      <strong>{t("logs.lastError")}:</strong> {retryInfo.lastError}
                                    </p>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
