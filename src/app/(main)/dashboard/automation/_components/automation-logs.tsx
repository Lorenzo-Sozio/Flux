"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, AlertCircle, Clock, ChevronDown, AlertTriangle, RotateCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatDistanceToNow } from "date-fns";

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
            Recent Executions
          </CardTitle>
          <CardDescription>No execution history yet</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-muted-foreground" />
          Recent Executions
        </CardTitle>
        <CardDescription>Last {displayLogs.length} automation runs</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow className="border-muted/50">
              <TableHead className="w-6"></TableHead>
              <TableHead className="w-12">Status</TableHead>
              <TableHead>Rule</TableHead>
              <TableHead>Entity</TableHead>
              <TableHead className="text-center w-20">Actions</TableHead>
              <TableHead className="text-right">Time</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayLogs.map((log) => {
              const loopInfo = log.loopInfo ? JSON.parse(log.loopInfo) : null;
              const retryInfo = log.retryInfo ? JSON.parse(log.retryInfo) : null;
              const isExpanded = expandedId === log.id;
              
              return (
                <tbody key={log.id}>
                  <TableRow className="border-muted/50 hover:bg-muted/30 cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : log.id)}>
                    {/* Expand button */}
                    <TableCell className="w-6">
                      {((log.loopDetected ?? false) || (log.retryCount ?? 0) > 0) && (
                        <button className="p-1 hover:bg-muted rounded transition-colors">
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
                            {log.success ? "Success" : log.errorMessage || "Failed"}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </TableCell>

                    {/* Rule Name */}
                    <TableCell>
                      <span className="text-sm font-medium">{log.ruleName}</span>
                    </TableCell>

                    {/* Entity */}
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {log.entityType} <span className="opacity-60 ml-1">#{log.entityId.slice(0, 8)}</span>
                      </Badge>
                    </TableCell>

                    {/* Actions Count */}
                    <TableCell className="text-center">
                      {log.success ? (
                        <Badge variant="secondary" className="text-xs">
                          {log.actionsExecuted} {log.actionsExecuted === 1 ? "action" : "actions"}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs text-muted-foreground">
                          —
                        </Badge>
                      )}
                    </TableCell>

                    {/* Time */}
                    <TableCell className="text-right text-xs text-muted-foreground">
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
                            <div className="flex items-start gap-3 rounded border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-3">
                              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-semibold text-amber-900 dark:text-amber-100 mb-2">🔄 Loop Detection</p>
                                <div className="text-xs text-amber-800 dark:text-amber-300 space-y-1">
                                  <p><strong>Depth:</strong> {loopInfo.depth || 0}</p>
                                  {loopInfo.triggeredRules && loopInfo.triggeredRules.length > 0 && (
                                    <p><strong>Triggered Rules:</strong> {loopInfo.triggeredRules.join(", ")}</p>
                                  )}
                                  {loopInfo.chain && loopInfo.chain.length > 0 && (
                                    <p><strong>Chain:</strong> {loopInfo.chain.join(" → ")}</p>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Retry Details */}
                          {(log.retryCount ?? 0) > 0 && retryInfo && (
                            <div className="flex items-start gap-3 rounded border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/20 p-3">
                              <RotateCw className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-semibold text-blue-900 dark:text-blue-100 mb-2">🔁 Retry Attempts</p>
                                <div className="text-xs text-blue-800 dark:text-blue-300 space-y-1">
                                  <p><strong>Attempts:</strong> {retryInfo.attempts || log.retryCount} / {retryInfo.maxAttempts || 3}</p>
                                  {retryInfo.exponentialBackoff && (
                                    <p><strong>Strategy:</strong> Exponential backoff</p>
                                  )}
                                  {retryInfo.lastError && (
                                    <p><strong>Last Error:</strong> {retryInfo.lastError}</p>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </tbody>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
