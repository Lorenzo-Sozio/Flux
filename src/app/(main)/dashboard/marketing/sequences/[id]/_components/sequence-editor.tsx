"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { deleteSequence, saveSequence } from "@/actions/sequences";
import { RichTextEditor } from "@/components/crm/rich-text-editor";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useMessageText } from "@/hooks/use-message-text";
import { MAX_STEPS } from "@/lib/sequence-plan";

interface Step {
  key: string;
  /** Bumped when a template replaces the text, so the editor shows it; never on typing. */
  version: number;
  delayDays: number;
  subject: string;
  body: string;
}

interface Props {
  sequence: {
    id: string;
    name: string;
    description: string | null;
    entityType: string;
    isActive: boolean;
  } | null;
  steps: { id: string; delayDays: number; subject: string; body: string }[];
  templates: { id: string; name: string; subject: string; body: string }[];
  canManage: boolean;
}

const newKey = () => Math.random().toString(36).slice(2);

export function SequenceEditor({ sequence, steps: initialSteps, templates, canManage }: Props) {
  const t = useTranslations("sequences");
  const say = useMessageText();
  const router = useRouter();
  const [name, setName] = useState(sequence?.name ?? "");
  const [description, setDescription] = useState(sequence?.description ?? "");
  const [entityType, setEntityType] = useState(sequence?.entityType ?? "lead");
  const [isActive, setIsActive] = useState(sequence?.isActive ?? true);
  const [steps, setSteps] = useState<Step[]>(
    initialSteps.length
      ? initialSteps.map((s) => ({ key: s.id, version: 0, delayDays: s.delayDays, subject: s.subject, body: s.body }))
      : [{ key: newKey(), version: 0, delayDays: 0, subject: "", body: "" }],
  );
  const [saving, setSaving] = useState(false);

  const put = (i: number, patch: Partial<Step>) =>
    setSteps((all) => all.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, by: number) =>
    setSteps((all) => {
      const next = [...all];
      const [taken] = next.splice(i, 1);
      next.splice(i + by, 0, taken);
      return next;
    });

  const save = async () => {
    setSaving(true);
    try {
      const result = await saveSequence(sequence?.id ?? null, {
        name,
        description,
        entityType,
        isActive,
        steps: steps.map(({ delayDays, subject, body }) => ({ delayDays: Number(delayDays), subject, body })),
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
  // Moving from lead to contact would strand the enrollments already running.
  const entityLocked = Boolean(sequence);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
          <div>
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
          <div>
            <Label>{t("for")}</Label>
            <Select value={entityType} onValueChange={setEntityType} disabled={disabled || entityLocked}>
              <SelectTrigger className="mt-1.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="lead">{t("entity.lead")}</SelectItem>
                <SelectItem value="contact">{t("entity.contact")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="seq-description">{t("description")}</Label>
            <Input
              id="seq-description"
              className="mt-1.5"
              value={description}
              disabled={disabled}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-3 sm:col-span-2">
            <Switch id="seq-active" checked={isActive} disabled={disabled} onCheckedChange={setIsActive} />
            <Label htmlFor="seq-active" className="cursor-pointer">
              {isActive ? t("activeLabel") : t("pausedLabel")}
            </Label>
          </div>
        </CardContent>
      </Card>

      {steps.map((step, i) => (
        <Card key={step.key}>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-base">{t("stepN", { n: i + 1 })}</CardTitle>
            {canManage && (
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                  aria-label={t("moveUp")}
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  disabled={i === steps.length - 1}
                  onClick={() => move(i, 1)}
                  aria-label={t("moveDown")}
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  disabled={steps.length === 1}
                  onClick={() => setSteps((all) => all.filter((_, j) => j !== i))}
                  aria-label={t("removeStep")}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>{i === 0 ? t("waitFirst") : t("waitNext")}</span>
              <Input
                aria-label={t("days")}
                type="number"
                min={0}
                max={365}
                className="h-8 w-20"
                value={step.delayDays}
                disabled={disabled}
                onChange={(e) => put(i, { delayDays: Number(e.target.value) })}
              />
              <span>{t("days")}</span>
              {canManage && templates.length > 0 && (
                <Select
                  value=""
                  onValueChange={(id) => {
                    const tpl = templates.find((x) => x.id === id);
                    if (tpl) put(i, { subject: tpl.subject, body: tpl.body, version: step.version + 1 });
                  }}
                >
                  <SelectTrigger className="ml-auto h-8 w-auto gap-1 text-xs">
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
            </div>
            <div>
              <Label htmlFor={`step-subject-${step.key}`}>{t("subject")}</Label>
              <Input
                id={`step-subject-${step.key}`}
                className="mt-1.5"
                value={step.subject}
                disabled={disabled}
                onChange={(e) => put(i, { subject: e.target.value })}
              />
            </div>
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
          </CardContent>
        </Card>
      ))}

      <p className="text-muted-foreground text-xs">
        {t("placeholdersHint", { examples: "{{firstName}}, {{lastName}}, {{company}}" })}
      </p>

      {canManage && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            variant="outline"
            className="gap-2"
            disabled={steps.length >= MAX_STEPS}
            onClick={() =>
              setSteps((all) => [...all, { key: newKey(), version: 0, delayDays: 3, subject: "", body: "" }])
            }
          >
            <Plus className="h-4 w-4" />
            {t("addStep")}
          </Button>
          <div className="flex gap-2">
            {sequence && (
              <Button variant="ghost" className="text-destructive" onClick={remove}>
                {t("delete")}
              </Button>
            )}
            <Button onClick={save} disabled={saving}>
              {saving ? t("saving") : t("save")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
