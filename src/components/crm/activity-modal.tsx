"use client";

import { useEffect, useState } from "react";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  BellIcon,
  ClockIcon,
  FileTextIcon,
  LinkIcon,
  Loader2Icon,
  MailIcon,
  PencilIcon,
  PhoneIcon,
  PlusIcon,
  UsersIcon,
} from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { createActivity, updateActivity } from "@/actions/activities";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

// ─── Schema ────────────────────────────────────────────────────────────────────

const activitySchema = z.object({
  type: z.enum(["note", "call", "meeting", "email"]),
  content: z.string().min(1, "Content is required"),
  date: z.string().optional(),
  durationMinutes: z.coerce.number().int().min(0).optional().nullable(),
  reminderMinutes: z.coerce.number().int().min(0).optional().nullable(),
  participants: z.string().optional(),
  // entity link (create mode)
  entityType: z.enum(["none", "lead", "contact", "company", "deal"]).optional(),
  entityId: z.string().optional(),
});

type ActivityFormValues = z.infer<typeof activitySchema>;

// ─── Config ────────────────────────────────────────────────────────────────────

const TYPE_CONFIG = {
  note: {
    label: "Note",
    icon: FileTextIcon,
    color: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  },
  call: {
    label: "Call",
    icon: PhoneIcon,
    color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
  },
  meeting: {
    label: "Meeting",
    icon: UsersIcon,
    color: "bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300",
  },
  email: { label: "Email", icon: MailIcon, color: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" },
} as const;

const REMINDER_OPTIONS = [
  { label: "No reminder", value: "__none__" },
  { label: "15 min before", value: "15" },
  { label: "30 min before", value: "30" },
  { label: "1 hour before", value: "60" },
  { label: "2 hours before", value: "120" },
  { label: "1 day before", value: "1440" },
];

const DURATION_OPTIONS = [
  { label: "—", value: "__none__" },
  { label: "15 min", value: "15" },
  { label: "30 min", value: "30" },
  { label: "45 min", value: "45" },
  { label: "1 hour", value: "60" },
  { label: "1.5 hours", value: "90" },
  { label: "2 hours", value: "120" },
  { label: "3 hours", value: "180" },
];

// ─── Helpers ───────────────────────────────────────────────────────────────────

function toDateTimeLocal(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = new Date(date);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ─── Props ─────────────────────────────────────────────────────────────────────

type CreateProps = {
  mode: "create";
  /** Pre-link the activity to an entity */
  entityType?: "lead" | "contact" | "company" | "deal";
  entityId?: string;
  ownerId?: string;
  revalidatePathStr: string;
  onCreated?: () => void;
};

type EditProps = {
  mode: "edit";
  activity: any;
  revalidatePathStr: string;
};

type Props = CreateProps | EditProps;

// ─── Component ─────────────────────────────────────────────────────────────────

export function ActivityModal(props: Props) {
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isEdit = props.mode === "edit";

  const form = useForm<ActivityFormValues>({
    resolver: zodResolver(activitySchema),
    defaultValues: isEdit
      ? {
          type: props.activity.type ?? "note",
          content: props.activity.content ?? "",
          date: toDateTimeLocal(props.activity.date),
          durationMinutes: props.activity.durationMinutes ?? null,
          reminderMinutes: props.activity.reminderMinutes ?? null,
          participants: props.activity.participants ?? "",
          entityType: "none",
          entityId: "",
        }
      : {
          type: "note",
          content: "",
          date: toDateTimeLocal(new Date()),
          durationMinutes: null,
          reminderMinutes: null,
          participants: "",
          entityType: (props as CreateProps).entityType ?? "none",
          entityId: (props as CreateProps).entityId ?? "",
        },
  });

  const selectedType = form.watch("type");
  const showDuration = selectedType === "call" || selectedType === "meeting";
  const showParticipants = selectedType === "meeting";

  // Reset defaults when type changes
  useEffect(() => {
    if (!showDuration) form.setValue("durationMinutes", null);
    if (!showParticipants) form.setValue("participants", "");
  }, [selectedType, showDuration, showParticipants, form]);

  const onSubmit = async (data: ActivityFormValues) => {
    try {
      setIsSubmitting(true);

      const payload = {
        type: data.type,
        content: data.content,
        date: data.date ? new Date(data.date) : undefined,
        durationMinutes: data.durationMinutes ?? undefined,
        reminderMinutes: data.reminderMinutes ?? undefined,
        participants: data.participants || undefined,
      };

      if (isEdit) {
        await updateActivity(props.activity.id, payload as any, props.revalidatePathStr);
        toast.success("Activity updated.");
      } else {
        const cp = props as CreateProps;
        const entityLink =
          data.entityType && data.entityType !== "none" && data.entityId
            ? { [`${data.entityType}Id`]: data.entityId }
            : cp.entityType && cp.entityId
              ? { [`${cp.entityType}Id`]: cp.entityId }
              : {};

        await createActivity({
          ...payload,
          ownerId: cp.ownerId,
          ...entityLink,
        } as any);

        toast.success("Activity logged.");
        if (cp.onCreated) cp.onCreated();
      }

      setOpen(false);
      form.reset();
    } catch {
      toast.error(isEdit ? "Failed to update activity." : "Failed to log activity.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const title = isEdit
    ? `Edit ${TYPE_CONFIG[props.activity.type as keyof typeof TYPE_CONFIG]?.label ?? "Activity"}`
    : "Log Activity";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {isEdit ? (
          <Button variant="ghost" size="icon" className="h-6 w-6">
            <PencilIcon className="h-3.5 w-3.5" />
          </Button>
        ) : (
          <Button variant="outline" size="sm" className="gap-1.5">
            <PlusIcon className="h-3.5 w-3.5" />
            Log Activity
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="sm:max-w-[560px] p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <DialogTitle className="text-lg">{title}</DialogTitle>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col">
          <div className="px-6 py-5 space-y-5">
            {/* ── Activity type selector ───────────────────────────── */}
            <div className="space-y-2">
              <Label>Type</Label>
              <div className="grid grid-cols-4 gap-2">
                {(
                  Object.entries(TYPE_CONFIG) as [
                    keyof typeof TYPE_CONFIG,
                    (typeof TYPE_CONFIG)[keyof typeof TYPE_CONFIG],
                  ][]
                ).map(([type, cfg]) => {
                  const Icon = cfg.icon;
                  const active = selectedType === type;
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => form.setValue("type", type)}
                      className={cn(
                        "flex flex-col items-center gap-1.5 rounded-lg border-2 p-3 text-xs font-medium transition-all",
                        active
                          ? "border-primary " + cfg.color
                          : "border-border text-muted-foreground hover:border-muted-foreground/40",
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {cfg.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── Date + Duration (conditional) ──────────────────── */}
            <div className={cn("grid gap-4", showDuration ? "grid-cols-2" : "grid-cols-1")}>
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">
                  <ClockIcon className="h-3.5 w-3.5 text-muted-foreground" />
                  Date & Time
                </Label>
                <input
                  type="datetime-local"
                  {...form.register("date")}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>

              {showDuration && (
                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5">
                    <ClockIcon className="h-3.5 w-3.5 text-muted-foreground" />
                    Duration
                  </Label>
                  <Controller
                    control={form.control}
                    name="durationMinutes"
                    render={({ field }) => (
                      <Select
                        value={field.value != null ? String(field.value) : "__none__"}
                        onValueChange={(v) => field.onChange(v === "__none__" ? null : Number(v))}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="—" />
                        </SelectTrigger>
                        <SelectContent>
                          {DURATION_OPTIONS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
              )}
            </div>

            {/* ── Content ──────────────────────────────────────────── */}
            <div className="space-y-2">
              <Label>
                {selectedType === "note"
                  ? "Note"
                  : selectedType === "call"
                    ? "Call summary"
                    : selectedType === "meeting"
                      ? "Agenda / Summary"
                      : "Email subject / notes"}
              </Label>
              <Textarea
                {...form.register("content")}
                placeholder={
                  selectedType === "note"
                    ? "Write your note…"
                    : selectedType === "call"
                      ? "What was discussed?"
                      : selectedType === "meeting"
                        ? "Agenda, decisions, follow-ups…"
                        : "Email subject or summary…"
                }
                className="min-h-[100px] resize-none"
              />
              {form.formState.errors.content && (
                <p className="text-xs text-destructive">{form.formState.errors.content.message}</p>
              )}
            </div>

            {/* ── Participants (meeting only) ───────────────────────── */}
            {showParticipants && (
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">
                  <UsersIcon className="h-3.5 w-3.5 text-muted-foreground" />
                  Participants
                </Label>
                <Input {...form.register("participants")} placeholder="Mario Rossi, mario@example.com…" />
                <p className="text-[11px] text-muted-foreground">Separate names or emails with commas</p>
              </div>
            )}

            {/* ── Entity link (create mode, no pre-linked entity) ── */}
            {!isEdit && !(props as CreateProps).entityId && (
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">
                  <LinkIcon className="h-3.5 w-3.5 text-muted-foreground" />
                  Link to (optional)
                </Label>
                <Controller
                  control={form.control}
                  name="entityType"
                  render={({ field }) => (
                    <Select value={field.value ?? "none"} onValueChange={field.onChange}>
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="Select entity type…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        <SelectItem value="lead">Lead</SelectItem>
                        <SelectItem value="contact">Contact</SelectItem>
                        <SelectItem value="company">Company</SelectItem>
                        <SelectItem value="deal">Deal</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
                {form.watch("entityType") && form.watch("entityType") !== "none" && (
                  <Input
                    {...form.register("entityId")}
                    placeholder={`${form.watch("entityType")} ID…`}
                    className="h-9 font-mono text-xs"
                  />
                )}
              </div>
            )}

            {/* ── Reminder ─────────────────────────────────────────── */}
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <BellIcon className="h-3.5 w-3.5 text-muted-foreground" />
                Reminder
              </Label>
              <Controller
                control={form.control}
                name="reminderMinutes"
                render={({ field }) => (
                  <Select
                    value={field.value != null ? String(field.value) : "__none__"}
                    onValueChange={(v) => field.onChange(v === "__none__" ? null : Number(v))}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="No reminder" />
                    </SelectTrigger>
                    <SelectContent>
                      {REMINDER_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>

          <DialogFooter className="px-6 py-4 border-t bg-muted/10">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting} className="gap-2">
              {isSubmitting && <Loader2Icon className="h-3.5 w-3.5 animate-spin" />}
              {isEdit ? "Save Changes" : "Log Activity"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
