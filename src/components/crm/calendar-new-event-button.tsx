"use client";

import { useState, useTransition } from "react";

import { useRouter } from "next/navigation";

import { CheckSquare, Loader2, Phone, Plus, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { createActivity } from "@/actions/activities";
import { createTask } from "@/actions/tasks";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
  defaultDate?: string; // yyyy-MM-dd for pre-filling the date
}

type EventType = "task" | "meeting" | "call";

export function CalendarNewEventButton({ defaultDate }: Props) {
  const t = useTranslations("calendar");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [eventType, setEventType] = useState<EventType>("task");
  const [title, setTitle] = useState("");
  const [dateTime, setDateTime] = useState(defaultDate ? `${defaultDate}T09:00` : "");
  const [priority, setPriority] = useState("normal");

  const reset = () => {
    setTitle("");
    setDateTime(defaultDate ? `${defaultDate}T09:00` : "");
    setPriority("normal");
    setEventType("task");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error(t("newEventDialog.titleRequired"));
      return;
    }
    if (!dateTime) {
      toast.error(t("newEventDialog.dateRequired"));
      return;
    }

    startTransition(async () => {
      try {
        const date = new Date(dateTime);

        if (eventType === "task") {
          await createTask({ title: title.trim(), dueDate: date, priority });
        } else {
          await createActivity({
            type: eventType,
            content: title.trim(),
            date,
          } as any);
        }

        toast.success(t("createSuccess"));
        setOpen(false);
        reset();
        router.refresh();
      } catch {
        toast.error(t("newEventDialog.createError"));
      }
    });
  };

  const TYPE_CONFIG: Record<EventType, { label: string; icon: React.ReactNode; color: string }> = {
    task: { label: t("typeTask"), icon: <CheckSquare className="h-4 w-4" />, color: "bg-blue-500" },
    meeting: { label: t("typeMeeting"), icon: <Users className="h-4 w-4" />, color: "bg-violet-500" },
    call: { label: t("typeCall"), icon: <Phone className="h-4 w-4" />, color: "bg-emerald-500" },
  };

  return (
    <>
      <Button size="sm" className="gap-2 shrink-0" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        {t("newEvent")}
      </Button>

      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) reset();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("newEvent")}</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4 py-2">
            {/* Event type selector */}
            <div className="grid grid-cols-3 gap-2">
              {(Object.entries(TYPE_CONFIG) as [EventType, (typeof TYPE_CONFIG)[EventType]][]).map(([type, cfg]) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setEventType(type)}
                  className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border-2 transition-all text-sm font-medium ${
                    eventType === type
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border hover:border-muted-foreground/40 text-muted-foreground"
                  }`}
                >
                  {cfg.icon}
                  {cfg.label}
                </button>
              ))}
            </div>

            {/* Title */}
            <div className="space-y-1.5">
              <Label htmlFor="new-event-title">
                {eventType === "task" ? t("newEventDialog.titleLabel") : t("newEventDialog.descLabel")}
              </Label>
              <Input
                id="new-event-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={
                  eventType === "task"
                    ? t("newEventDialog.titlePlaceholderTask")
                    : t("newEventDialog.titlePlaceholderOther")
                }
                autoFocus
              />
            </div>

            {/* Date & time */}
            <div className="space-y-1.5">
              <Label htmlFor="new-event-datetime">{t("newEventDialog.dateTimeLabel")}</Label>
              <input
                id="new-event-datetime"
                type="datetime-local"
                value={dateTime}
                onChange={(e) => setDateTime(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>

            {/* Priority (tasks only) */}
            {eventType === "task" && (
              <div className="space-y-1.5">
                <Label htmlFor="new-event-priority">{t("newEventDialog.priorityLabel")}</Label>
                <select
                  id="new-event-priority"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="low">{t("newEventDialog.priorityLow")}</option>
                  <option value="normal">{t("newEventDialog.priorityNormal")}</option>
                  <option value="high">{t("newEventDialog.priorityHigh")}</option>
                </select>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                {t("newEventDialog.cancel")}
              </Button>
              <Button type="submit" disabled={isPending} className="gap-2">
                {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {t("newEventDialog.createBtn", { label: TYPE_CONFIG[eventType].label })}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
