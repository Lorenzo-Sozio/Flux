"use client";

import { useEffect, useRef, useState } from "react";

import { Clock, Pause, Play, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { deleteTimeLog, getTimeLogs, logHoursManual, startTimer, stopTimer } from "@/actions/tasks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type TimeLog = {
  id: string;
  userId: string;
  userName: string | null;
  startedAt: Date;
  stoppedAt: Date | null;
  hours: string | null;
  note: string | null;
  createdAt: Date;
};

function formatElapsed(ms: number) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function formatHours(h: string | null) {
  if (!h) return "—";
  const n = parseFloat(h);
  return n < 1 ? `${Math.round(n * 60)}m` : `${n.toFixed(2)}h`;
}

interface Props {
  taskId: string;
  userId: string;
  estimatedHours: string | null;
  actualHours: string | null;
  onHoursChanged?: () => void;
}

const STORAGE_KEY = (id: string) => `task_timer_${id}`;

export function TaskTimer({ taskId, userId, estimatedHours, actualHours, onHoursChanged }: Props) {
  const [logs, setLogs] = useState<TimeLog[]>([]);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [activeLogId, setActiveLogId] = useState<string | null>(null);
  const [manualHours, setManualHours] = useState("");
  const [manualNote, setManualNote] = useState("");
  const [showManual, setShowManual] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Restore timer state from localStorage on mount
  useEffect(() => {
    getTimeLogs(taskId)
      .then(setLogs)
      .catch(() => {});
    const stored = localStorage.getItem(STORAGE_KEY(taskId));
    if (stored) {
      try {
        const { logId, startedAt } = JSON.parse(stored);
        setActiveLogId(logId);
        setRunning(true);
        setElapsed(Date.now() - new Date(startedAt).getTime());
      } catch {
        localStorage.removeItem(STORAGE_KEY(taskId));
      }
    }
  }, [taskId]);

  // Tick interval when running
  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(() => setElapsed((e) => e + 1000), 1000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [running]);

  const handleStart = async () => {
    try {
      const log = await startTimer(taskId, userId);
      localStorage.setItem(STORAGE_KEY(taskId), JSON.stringify({ logId: log.id, startedAt: log.startedAt }));
      setActiveLogId(log.id);
      setElapsed(0);
      setRunning(true);
    } catch {
      toast.error("Failed to start timer.");
    }
  };

  const handleStop = async () => {
    if (!activeLogId) return;
    try {
      await stopTimer(activeLogId);
      localStorage.removeItem(STORAGE_KEY(taskId));
      setRunning(false);
      setActiveLogId(null);
      setElapsed(0);
      const updated = await getTimeLogs(taskId);
      setLogs(updated);
      onHoursChanged?.();
      toast.success("Time logged.");
    } catch {
      toast.error("Failed to stop timer.");
    }
  };

  const handleManualLog = async () => {
    const h = parseFloat(manualHours);
    if (!h || h <= 0) {
      toast.error("Enter valid hours.");
      return;
    }
    try {
      await logHoursManual(taskId, userId, h, manualNote || undefined);
      const updated = await getTimeLogs(taskId);
      setLogs(updated);
      setManualHours("");
      setManualNote("");
      setShowManual(false);
      onHoursChanged?.();
      toast.success("Hours logged.");
    } catch {
      toast.error("Failed to log hours.");
    }
  };

  const handleDeleteLog = async (logId: string) => {
    try {
      await deleteTimeLog(logId, taskId);
      setLogs((prev) => prev.filter((l) => l.id !== logId));
      onHoursChanged?.();
    } catch {
      toast.error("Failed to delete log.");
    }
  };

  const estHrs = estimatedHours ? parseFloat(estimatedHours) : null;
  const actHrs = actualHours ? parseFloat(actualHours) : 0;
  const overBudget = estHrs !== null && actHrs > estHrs;

  return (
    <div className="space-y-3">
      {/* Hours summary */}
      <div className="flex items-center gap-4 text-xs">
        <div className="flex items-center gap-1">
          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">Est:</span>
          <span className="font-medium">{estHrs !== null ? `${estHrs}h` : "—"}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground">Actual:</span>
          <span className={cn("font-medium tabular-nums", overBudget && "text-destructive")}>
            {actHrs > 0 ? `${actHrs}h` : "0h"}
          </span>
          {overBudget && (
            <span className="text-destructive text-[10px]">({((actHrs / estHrs!) * 100 - 100).toFixed(0)}% over)</span>
          )}
        </div>
      </div>

      {/* Timer control */}
      <div className="flex items-center gap-2">
        {running ? (
          <>
            <span className="tabular-nums text-sm font-mono font-medium text-primary w-20">
              {formatElapsed(elapsed)}
            </span>
            <Button type="button" size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={handleStop}>
              <Pause className="h-3 w-3" />
              Stop
            </Button>
          </>
        ) : (
          <Button type="button" size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={handleStart}>
            <Play className="h-3 w-3" />
            Start Timer
          </Button>
        )}
        {!running && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-muted-foreground"
            onClick={() => setShowManual((v) => !v)}
          >
            + Log manually
          </Button>
        )}
      </div>

      {/* Manual log form */}
      {showManual && (
        <div className="flex items-center gap-1.5">
          <Input
            type="number"
            step="0.25"
            min="0.25"
            value={manualHours}
            onChange={(e) => setManualHours(e.target.value)}
            placeholder="Hours (e.g. 1.5)"
            className="h-7 text-xs w-28"
          />
          <Input
            value={manualNote}
            onChange={(e) => setManualNote(e.target.value)}
            placeholder="Note (optional)"
            className="h-7 text-xs flex-1"
          />
          <Button type="button" size="sm" className="h-7 text-xs" onClick={handleManualLog}>
            Log
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowManual(false)}>
            ✕
          </Button>
        </div>
      )}

      {/* Log history */}
      {logs.length > 0 && (
        <div className="space-y-1 max-h-32 overflow-y-auto">
          {logs.map((log) => (
            <div
              key={log.id}
              className="flex items-center gap-2 text-[10px] text-muted-foreground group rounded px-1 hover:bg-muted/30"
            >
              <span className="shrink-0 font-medium text-foreground">{formatHours(log.hours)}</span>
              <span className="truncate flex-1">{log.userName ?? log.userId}</span>
              {log.note && <span className="truncate max-w-[100px] italic">{log.note}</span>}
              <span className="shrink-0">
                {new Date(log.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
              </span>
              <button
                type="button"
                onClick={() => handleDeleteLog(log.id)}
                className="shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground/40 hover:text-destructive transition-all"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
