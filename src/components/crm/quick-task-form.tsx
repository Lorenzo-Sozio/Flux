"use client";

import { useState, useTransition } from "react";

import { useRouter } from "next/navigation";

import { format } from "date-fns";
import { it } from "date-fns/locale";
import { CalendarDays, CalendarIcon, Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { createTask } from "@/actions/tasks";
import { AssigneeSelect, decodeAssignee, encodeAssignee } from "@/components/crm/assignee-select";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

// ─── Config ────────────────────────────────────────────────────────────────────

const PRIORITY_CONFIG = {
  blocker: { color: "#dc2626" },
  critical: { color: "#ea580c" },
  high: { color: "#ef4444" },
  normal: { color: "#6366f1" },
  low: { color: "#94a3b8" },
} as const;

type Priority = keyof typeof PRIORITY_CONFIG;
const PRIORITIES: Priority[] = ["blocker", "critical", "high", "normal", "low"];

// ─── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  entityType: "lead" | "contact" | "company";
  entityId: string;
  userId: string;
}

// ─── DateTimePicker ────────────────────────────────────────────────────────────

function DateTimePicker({
  label,
  value,
  onChange,
  timeValue,
  onTimeChange,
  showTime,
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  timeValue: string;
  onTimeChange: (v: string) => void;
  showTime: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? new Date(value) : undefined;

  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="flex items-center gap-1.5">
        <div className="relative flex items-center">
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(
                  "flex h-9 min-w-[140px] items-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-sm shadow-sm transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  selected ? "pr-7" : "text-muted-foreground",
                )}
              >
                <CalendarIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
                <span className="flex-1 text-left">
                  {selected ? format(selected, "d MMM yyyy", { locale: it }) : "—"}
                </span>
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={selected}
                onSelect={(date) => {
                  onChange(date ? format(date, "yyyy-MM-dd") : undefined);
                  setOpen(false);
                }}
                locale={it}
                captionLayout="dropdown"
              />
            </PopoverContent>
          </Popover>
          {selected && (
            <button
              type="button"
              onClick={() => onChange(undefined)}
              aria-label="Cancella data"
              className="absolute right-1.5 rounded-sm p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        {showTime && (
          <input
            type="time"
            value={timeValue}
            onChange={(e) => onTimeChange(e.target.value)}
            className="h-9 w-[5.5rem] shrink-0 rounded-md border border-input bg-background px-2 text-sm tabular-nums shadow-sm transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        )}
      </div>
    </div>
  );
}

// ─── Component ─────────────────────────────────────────────────────────────────

export function QuickTaskForm({ entityType, entityId, userId }: Props) {
  const tD = useTranslations("entityDetail");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Priority>("normal");
  const [allDay, setAllDay] = useState(true);
  const [startDate, setStartDate] = useState<string | undefined>(undefined);
  const [startTime, setStartTime] = useState("09:00");
  const [dueDate, setDueDate] = useState<string | undefined>(undefined);
  const [dueTime, setDueTime] = useState("18:00");
  const [assigneeValue, setAssigneeValue] = useState<string>(encodeAssignee(userId, null));

  const priorityLabels: Record<Priority, string> = {
    blocker: tD("priorityBlocker"),
    critical: tD("priorityCritical"),
    high: tD("priorityHigh"),
    normal: tD("priorityNormal"),
    low: tD("priorityLow"),
  };

  function buildDate(dateStr: string | undefined, timeStr: string): Date | undefined {
    if (!dateStr) return undefined;
    if (allDay) return new Date(`${dateStr}T00:00:00`);
    return new Date(`${dateStr}T${timeStr}:00`);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;

    const { ownerId } = decodeAssignee(assigneeValue);
    const resolvedAssignee = ownerId ?? userId;

    const entityPayload =
      entityType === "lead"
        ? { leadId: entityId }
        : entityType === "contact"
          ? { contactId: entityId }
          : { companyId: entityId };

    startTransition(async () => {
      try {
        await createTask({
          title: title.trim(),
          description: description.trim() || undefined,
          status: "todo",
          priority,
          allDay,
          startDate: buildDate(startDate, startTime),
          dueDate: buildDate(dueDate, dueTime),
          ownerId: userId,
          assigneeId: resolvedAssignee,
          ...entityPayload,
        });

        toast.success(tD("taskCreated"));

        setTitle("");
        setDescription("");
        setPriority("normal");
        setAllDay(true);
        setStartDate(undefined);
        setStartTime("09:00");
        setDueDate(undefined);
        setDueTime("18:00");
        setAssigneeValue(encodeAssignee(userId, null));

        router.refresh();
      } catch {
        toast.error(tD("taskCreateFailed"));
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-4">
      {/* ── Title ─────────────────────────────────────────────────────────── */}
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={tD("taskTitlePlaceholder")}
        required
        className="rounded-none border-0 border-b bg-transparent px-0 text-sm font-medium shadow-none focus-visible:border-primary focus-visible:ring-0"
      />

      {/* ── Description ───────────────────────────────────────────────────── */}
      <Textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder={tD("taskDescPlaceholder")}
        className="h-20 bg-background"
      />

      {/* ── Priority pills ─────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-1.5">
        <p className="ml-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{tD("priorityLabel")}</p>
        <div className="flex flex-wrap gap-1.5">
          {PRIORITIES.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPriority(p)}
              className={cn(
                "flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors",
                priority === p
                  ? "border-transparent bg-muted font-medium text-foreground shadow-xs"
                  : "border-input bg-transparent text-muted-foreground hover:bg-accent/50",
              )}
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: PRIORITY_CONFIG[p].color }} />
              {priorityLabels[p]}
            </button>
          ))}
        </div>
      </div>

      {/* ── Scheduling ────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setAllDay((v) => !v)}
          className={cn(
            "flex w-fit items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition-colors",
            allDay
              ? "border-primary/30 bg-primary/10 text-primary"
              : "border-input bg-transparent text-muted-foreground hover:bg-accent/50",
          )}
        >
          <CalendarDays className="h-3.5 w-3.5" />
          {tD("allDay")}
        </button>

        <div className="flex flex-wrap gap-3">
          <DateTimePicker
            label={tD("startDateLabel")}
            value={startDate}
            onChange={setStartDate}
            timeValue={startTime}
            onTimeChange={setStartTime}
            showTime={!allDay}
          />
          <DateTimePicker
            label={tD("endDateLabel")}
            value={dueDate}
            onChange={setDueDate}
            timeValue={dueTime}
            onTimeChange={setDueTime}
            showTime={!allDay}
          />
        </div>
      </div>

      {/* ── Assignee + submit ──────────────────────────────────────────────── */}
      <div className="flex flex-col gap-1.5">
        <p className="ml-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{tD("assignToLabel")}</p>
        <AssigneeSelect value={assigneeValue} onChange={setAssigneeValue} disabled={isPending} />
      </div>

      <Button type="submit" size="sm" disabled={isPending || !title.trim()} className="mt-1 self-end gap-1.5">
        {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {tD("createTask")}
      </Button>
    </form>
  );
}
