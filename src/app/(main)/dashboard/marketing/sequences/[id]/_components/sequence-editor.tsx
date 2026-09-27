"use client";

import { type ReactNode, useState } from "react";

import { useRouter } from "next/navigation";

import {
  ArrowDown,
  ArrowUp,
  ChevronDownIcon,
  ListOrderedIcon,
  Plus,
  SettingsIcon,
  Trash2,
  UsersIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { deleteSequence, saveSequence } from "@/actions/sequences";
import { RecordSections } from "@/components/crm/record/record-sections";
import { RichTextEditor } from "@/components/crm/rich-text-editor";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useMessageText } from "@/hooks/use-message-text";
import { MAX_STEPS, type StepKind } from "@/lib/sequence-plan";
import { isTaskType, TASK_TYPES, type TaskType } from "@/lib/task-kinds";
import { cn } from "@/lib/utils";

interface Step {
  key: string;
  /** Bumped when a template replaces the text, so the editor shows it; never on typing. */
  version: number;
  delayDays: number;
  subject: string;
  body: string;
  /** An email, or a task for the salesperson (src/lib/sequence-plan.ts). */
  kind: StepKind;
  taskType: TaskType;
  replyInThread: boolean;
}

type StoredStep = {
  id: string;
  delayDays: number;
  subject: string;
  body: string;
  kind?: string | null;
  taskType?: string | null;
  replyInThread?: boolean | null;
};

const toStep = (s: StoredStep): Step => ({
  key: s.id,
  version: 0,
  delayDays: s.delayDays,
  subject: s.subject,
  body: s.body,
  kind: s.kind === "task" ? "task" : "email",
  taskType: isTaskType(s.taskType) ? s.taskType : "call",
  replyInThread: Boolean(s.replyInThread),
});

interface Props {
  sequence: {
    id: string;
    name: string;
    description: string | null;
    entityType: string;
    isActive: boolean;
    businessDays?: boolean | null;
    sendFrom?: string | null;
    sendUntil?: string | null;
  } | null;
  steps: StoredStep[];
  templates: { id: string; name: string; subject: string; body: string }[];
  canManage: boolean;
  /** The enrollments card, drawn by the page; absent for a sequence not yet saved. */
  enrollments?: ReactNode;
  enrolledCount?: number;
}

const newKey = () => Math.random().toString(36).slice(2);

/**
 * The sequence as a form: its steps, who is on it, and its settings, as sections
 * of one record, with the save bar pinned to the bottom edge.
 *
 * ⚠️ The sections live here rather than in the page because the settings and the
 * steps are one form: one piece of state, saved by one button. Splitting them into
 * two server-rendered sections would have meant two forms that could disagree.
 * The enrollments are drawn by the page and handed in as a node, so this client
 * component does not have to carry the list of people through props twice.
 */
export function SequenceEditor({
  sequence,
  steps: initialSteps,
  templates,
  canManage,
  enrollments,
  enrolledCount,
}: Props) {
  const t = useTranslations("sequences");
  const tR = useTranslations("record");
  const say = useMessageText();
  const router = useRouter();
  const [name, setName] = useState(sequence?.name ?? "");
  const [description, setDescription] = useState(sequence?.description ?? "");
  const [entityType, setEntityType] = useState(sequence?.entityType ?? "lead");
  const [isActive, setIsActive] = useState(sequence?.isActive ?? true);
  const [businessDays, setBusinessDays] = useState(Boolean(sequence?.businessDays));
  const [sendFrom, setSendFrom] = useState(sequence?.sendFrom ?? "");
  const [sendUntil, setSendUntil] = useState(sequence?.sendUntil ?? "");
  const [steps, setSteps] = useState<Step[]>(() =>
    initialSteps.length
      ? initialSteps.map(toStep)
      : // ⚠️ A fixed key, not `newKey()`: this runs on the server and again in the
        // browser, and a random key there put two different ids on the first
        // step's label and input — a hydration mismatch on every new sequence.
        [
          {
            key: "first",
            version: 0,
            delayDays: 0,
            subject: "",
            body: "",
            kind: "email",
            taskType: "call",
            replyInThread: false,
          },
        ],
  );
  // Which steps are unfolded. Two or fewer are all open; beyond that only the
  // first, so a five-step sequence opens as five readable lines — delay and
  // subject — instead of five editors one under another. A folded step is only
  // hidden: its editor stays mounted and keeps what was typed.
  const [openKeys, setOpenKeys] = useState<Set<string>>(
    () => new Set(steps.length > 2 ? [steps[0].key] : steps.map((s) => s.key)),
  );
  const [saving, setSaving] = useState(false);

  const setOpen = (key: string, open: boolean) =>
    setOpenKeys((prev) => {
      if (prev.has(key) === open) return prev;
      const next = new Set(prev);
      if (open) next.add(key);
      else next.delete(key);
      return next;
    });

  const put = (i: number, patch: Partial<Step>) =>
    setSteps((all) => all.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, by: number) =>
    setSteps((all) => {
      const next = [...all];
      const [taken] = next.splice(i, 1);
      next.splice(i + by, 0, taken);
      return next;
    });
  const addStep = () => {
    const key = newKey();
    setSteps((all) => [
      ...all,
      // A follow-up to an email answers it in its thread unless somebody says otherwise.
      {
        key,
        version: 0,
        delayDays: 3,
        subject: "",
        body: "",
        kind: "email",
        taskType: "call",
        replyInThread: all.some((st) => st.kind === "email"),
      },
    ]);
    setOpen(key, true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const result = await saveSequence(sequence?.id ?? null, {
        name,
        description,
        entityType,
        isActive,
        businessDays,
        sendFrom: sendFrom || null,
        sendUntil: sendUntil || null,
        steps: steps.map(({ delayDays, subject, body, kind, taskType, replyInThread }) => ({
          delayDays: Number(delayDays),
          subject,
          body,
          kind,
          taskType,
          replyInThread,
        })),
      });
      if (!result.ok) {
        toast.error(say(result));
        return;
      }
      toast.success(t("saved"));
      if (!sequence) router.replace(`/dashboard/marketing/sequences/${result.id}`);
      else router.refresh();
    } catch {
      toast.error(t("failed"));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!sequence || !window.confirm(t("deleteConfirm"))) return;
    await deleteSequence(sequence.id);
    toast.success(t("deleted"));
    router.replace("/dashboard/marketing/sequences");
  };

  const disabled = !canManage;
  // Only an email with an email before it can answer in that one's thread (cleanSequence agrees).
  const canThread = (i: number) => steps[i].kind === "email" && steps.slice(0, i).some((st) => st.kind === "email");
  const answersThread = (i: number) => canThread(i) && steps[i].replyInThread;
  // Moving from lead to contact would strand the enrollments already running.
  const entityLocked = Boolean(sequence);

  // ── Settings ──
  const settings = (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{tR("tabs.settings")}</CardTitle>
      </CardHeader>
      {/* One column in the side column from lg: two there would be 150px a field. */}
      <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-1">
        <div className="min-w-0">
          <Label htmlFor="seq-name">{t("name")}</Label>
          <Input
            id="seq-name"
            className="mt-1.5"
            value={name}
            disabled={disabled}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("namePlaceholder")}
          />
        </div>
        <div className="min-w-0">
          <Label>{t("for")}</Label>
          <Select value={entityType} onValueChange={setEntityType} disabled={disabled || entityLocked}>
            <SelectTrigger className="mt-1.5 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="lead">{t("entity.lead")}</SelectItem>
              <SelectItem value="contact">{t("entity.contact")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-0 sm:col-span-2 lg:col-span-1">
          <Label htmlFor="seq-description">{t("description")}</Label>
          <Input
            id="seq-description"
            className="mt-1.5"
            value={description}
            disabled={disabled}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="flex min-h-11 items-center gap-3 sm:col-span-2 lg:col-span-1">
          <Switch id="seq-business" checked={businessDays} disabled={disabled} onCheckedChange={setBusinessDays} />
          <Label htmlFor="seq-business" className="cursor-pointer leading-snug">
            {t("businessDays")}
          </Label>
        </div>
        <div className="min-w-0 sm:col-span-2 lg:col-span-1">
          <Label>{t("sendWindow")}</Label>
          <div className="mt-1.5 flex items-center gap-2">
            <Input
              type="time"
              aria-label={t("sendFrom")}
              value={sendFrom}
              disabled={disabled}
              onChange={(e) => setSendFrom(e.target.value)}
              className="min-w-0 flex-1"
            />
            <span className="text-muted-foreground text-sm">–</span>
            <Input
              type="time"
              aria-label={t("sendUntil")}
              value={sendUntil}
              disabled={disabled}
              onChange={(e) => setSendUntil(e.target.value)}
              className="min-w-0 flex-1"
            />
          </div>
          <p className="mt-1 text-muted-foreground text-xs">{t("sendWindowHelp")}</p>
        </div>
        <div className="flex min-h-11 items-center gap-3 sm:col-span-2 lg:col-span-1">
          <Switch id="seq-active" checked={isActive} disabled={disabled} onCheckedChange={setIsActive} />
          <Label htmlFor="seq-active" className="cursor-pointer leading-snug">
            {isActive ? t("activeLabel") : t("pausedLabel")}
          </Label>
        </div>
      </CardContent>
    </Card>
  );

  // ── Steps ──
  const stepList = (
    <div className="space-y-3">
      {steps.map((step, i) => {
        const open = openKeys.has(step.key);
        return (
          <details
            key={step.key}
            open={open}
            onToggle={(e) => setOpen(step.key, e.currentTarget.open)}
            className="group/step rounded-xl border bg-card text-card-foreground shadow-sm"
          >
            {/* The folded step says what it does: when, and under which subject. */}
            <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary text-xs tabular-nums">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-sm">
                  {t("stepN", { n: i + 1 })}
                  <span className="font-normal text-muted-foreground">
                    {" · "}
                    {t("detail.stepDelay", { days: Number(step.delayDays) || 0 })}
                  </span>
                </span>
                <span
                  className={cn(
                    "block truncate text-xs",
                    step.subject ? "text-foreground/80" : "text-muted-foreground italic",
                  )}
                >
                  {step.kind === "task"
                    ? t("taskSummary", { type: t(`taskTypes.${step.taskType}`), title: step.subject || "—" })
                    : answersThread(i)
                      ? t("replySummary")
                      : step.subject || t("detail.noSubject")}
                </span>
              </span>
              <ChevronDownIcon
                className="size-4 shrink-0 text-muted-foreground transition-transform group-open/step:rotate-180"
                aria-hidden
              />
            </summary>

            <div className="space-y-3 border-t px-4 pt-3 pb-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span>{i === 0 ? t("waitFirst") : t("waitNext")}</span>
                <Input
                  aria-label={t("days")}
                  type="number"
                  min={0}
                  max={365}
                  className="h-11 w-20 text-base md:h-8 md:text-sm"
                  value={step.delayDays}
                  disabled={disabled}
                  onChange={(e) => put(i, { delayDays: Number(e.target.value) })}
                />
                <span>{t("days")}</span>
              </div>

              {canManage && (
                // Controls, not the summary: a button inside a <summary> toggles
                // the step as well as doing its own job.
                <div className="flex flex-wrap items-center gap-1">
                  {templates.length > 0 && step.kind === "email" && (
                    <Select
                      value=""
                      onValueChange={(id) => {
                        const tpl = templates.find((x) => x.id === id);
                        if (tpl) put(i, { subject: tpl.subject, body: tpl.body, version: step.version + 1 });
                      }}
                    >
                      <SelectTrigger className="h-11 w-auto min-w-0 gap-1 text-xs md:h-8">
                        <SelectValue placeholder={t("fromTemplate")} />
                      </SelectTrigger>
                      <SelectContent>
                        {templates.map((tpl) => (
                          <SelectItem key={tpl.id} value={tpl.id}>
                            {tpl.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <div className="ml-auto flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-11 md:size-7"
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                      aria-label={t("moveUp")}
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-11 md:size-7"
                      disabled={i === steps.length - 1}
                      onClick={() => move(i, 1)}
                      aria-label={t("moveDown")}
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-11 text-muted-foreground hover:text-destructive md:size-7"
                      disabled={steps.length === 1}
                      onClick={() => setSteps((all) => all.filter((_, j) => j !== i))}
                      aria-label={t("removeStep")}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="min-w-0">
                  <Label>{t("stepKind")}</Label>
                  <Select
                    value={step.kind}
                    onValueChange={(v) =>
                      // The body goes with the kind: an email's HTML is not a note for the salesperson.
                      put(i, { kind: v as StepKind, body: "", version: step.version + 1 })
                    }
                    disabled={disabled}
                  >
                    <SelectTrigger className="mt-1.5 w-full" aria-label={t("stepKind")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="email">{t("kinds.email")}</SelectItem>
                      <SelectItem value="task">{t("kinds.task")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {step.kind === "task" && (
                  <div className="min-w-0">
                    <Label>{t("taskType")}</Label>
                    <Select
                      value={step.taskType}
                      onValueChange={(v) => put(i, { taskType: v as TaskType })}
                      disabled={disabled}
                    >
                      <SelectTrigger className="mt-1.5 w-full" aria-label={t("taskType")}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TASK_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>
                            {t(`taskTypes.${type}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              {canThread(i) && (
                <div className="flex min-h-11 items-center gap-3">
                  <Switch
                    id={`step-thread-${step.key}`}
                    checked={step.replyInThread}
                    disabled={disabled}
                    onCheckedChange={(v) => put(i, { replyInThread: v })}
                  />
                  <Label htmlFor={`step-thread-${step.key}`} className="cursor-pointer leading-snug">
                    {t("replyInThread")}
                  </Label>
                </div>
              )}

              {!answersThread(i) && (
                <div>
                  <Label htmlFor={`step-subject-${step.key}`}>
                    {step.kind === "task" ? t("taskTitle") : t("subject")}
                  </Label>
                  <Input
                    id={`step-subject-${step.key}`}
                    className="mt-1.5"
                    value={step.subject}
                    disabled={disabled}
                    onChange={(e) => put(i, { subject: e.target.value })}
                  />
                </div>
              )}
              {step.kind === "task" ? (
                <div>
                  <Label htmlFor={`step-note-${step.key}`}>{t("taskNote")}</Label>
                  <Textarea
                    id={`step-note-${step.key}`}
                    className="mt-1.5"
                    rows={3}
                    value={step.body}
                    disabled={disabled}
                    onChange={(e) => put(i, { body: e.target.value })}
                  />
                </div>
              ) : (
                <div>
                  <Label>{t("body")}</Label>
                  <div className="mt-1.5">
                    {/* Keyed on the template version: remounting on every keystroke would drop the focus. */}
                    <RichTextEditor
                      key={`${step.key}-${step.version}`}
                      value={step.body}
                      onChange={(body) => put(i, { body })}
                    />
                  </div>
                </div>
              )}
            </div>
          </details>
        );
      })}

      <p className="text-muted-foreground text-xs">
        {t("placeholdersHint", { examples: "{{firstName}}, {{lastName}}, {{company}}" })}
      </p>

      {canManage && (
        <Button
          variant="outline"
          className="w-full gap-2 max-md:h-11 sm:w-auto"
          disabled={steps.length >= MAX_STEPS}
          onClick={addStep}
        >
          <Plus className="h-4 w-4" />
          {t("addStep")}
        </Button>
      )}
    </div>
  );

  // A new sequence opens on its settings: it cannot be saved without a name.
  const settingsTab = { id: "settings", label: tR("tabs.settings"), icon: <SettingsIcon aria-hidden /> };
  const stepsTab = { id: "steps", label: tR("tabs.steps"), icon: <ListOrderedIcon aria-hidden />, count: steps.length };

  return (
    <div className="flex min-w-0 flex-col gap-4 sm:gap-6">
      <RecordSections
        label={tR("sectionsLabel")}
        tabs={[
          ...(sequence ? [stepsTab] : [settingsTab, stepsTab]),
          { id: "enrollments", label: tR("tabs.enrollments"), icon: <UsersIcon aria-hidden />, count: enrolledCount },
          ...(sequence ? [settingsTab] : []),
        ]}
        sections={[
          { tab: "steps", column: "main", node: stepList },
          ...(enrollments ? [{ tab: "enrollments", column: "main" as const, node: enrollments }] : []),
          { tab: "settings", column: "side", node: settings },
        ]}
      />

      {canManage && (
        // ⚠️ Pinned to the bottom edge of the scrolling area on every width: the
        // steps can run to several screens, and a save button at the end of them
        // is a button nobody finds after editing step one. The dashboard's scroll
        // container already pads its bottom by the height of the phone's tab bar,
        // which is what keeps this above it rather than under it.
        <div
          data-bottom-bar=""
          className="sticky bottom-0 z-10 flex flex-wrap items-center justify-end gap-2 rounded-lg border bg-background/95 p-3 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/80"
        >
          {sequence && (
            <Button variant="ghost" className="text-destructive max-sm:flex-1 max-md:h-11" onClick={remove}>
              {t("delete")}
            </Button>
          )}
          <Button onClick={save} disabled={saving} className="max-sm:flex-1 max-md:h-11">
            {saving ? t("saving") : t("save")}
          </Button>
        </div>
      )}
    </div>
  );
}
