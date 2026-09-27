"use client";

import { useState } from "react";

import { ChevronDown, ChevronUp, GripVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { createPipelineStage, deletePipelineStage, updatePipelineStage } from "@/actions/pipeline";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { kindOf, STAGE_KINDS, type StageKind, type StageKindRefusal } from "@/lib/stage-kind";

import { type LossReasonRow, LossReasonsCard } from "./loss-reasons-card";

type Stage = {
  id: string;
  name: string;
  order: number;
  color: string | null;
  defaultProbability: number | null;
  isWon: boolean;
  isLost: boolean;
  staleAfterDays?: number | null;
};

type StageForm = {
  name: string;
  color: string;
  defaultProbability: number;
  kind: StageKind;
  /** Empty for no limit. */
  staleAfterDays: string;
};

const DEFAULT_FORM: StageForm = { name: "", color: "#94a3b8", defaultProbability: 0, kind: "open", staleAfterDays: "" };

/** The threshold as stored: a whole number of days, or null for none. */
const staleDays = (value: string): number | null => {
  const n = Math.round(Number(value));
  return value.trim() && Number.isFinite(n) && n > 0 ? Math.min(n, 365) : null;
};

export function PipelineStagesClient({
  stages: initialStages,
  lossReasons,
  pipelineId,
}: {
  stages: Stage[];
  lossReasons: LossReasonRow[];
  /** The pipeline these stages belong to; a new stage goes into it. */
  pipelineId?: string;
}) {
  const t = useTranslations("settings.pipeline");
  const tc = useTranslations("common");

  const [stages, setStages] = useState<Stage[]>([...initialStages].sort((a, b) => a.order - b.order));
  const [addOpen, setAddOpen] = useState(false);
  const [editStage, setEditStage] = useState<Stage | null>(null);
  const [form, setForm] = useState<StageForm>(DEFAULT_FORM);
  const [isPending, setIsPending] = useState(false);
  const [deleting, setDeleting] = useState<Stage | null>(null);

  // A refusal is an answer, not a failure: it says which rule the change broke.
  const refused = (reason: StageKindRefusal) => toast.error(t(`kindRefused.${reason}`));

  const openAdd = () => {
    setForm(DEFAULT_FORM);
    setAddOpen(true);
  };

  const openEdit = (stage: Stage) => {
    setForm({
      name: stage.name,
      color: stage.color ?? "#94a3b8",
      defaultProbability: stage.defaultProbability ?? 0,
      kind: kindOf(stage),
      staleAfterDays: stage.staleAfterDays ? String(stage.staleAfterDays) : "",
    });
    setEditStage(stage);
  };

  const handleAdd = async () => {
    if (!form.name.trim()) return;
    setIsPending(true);
    try {
      const result = await createPipelineStage({
        name: form.name,
        color: form.color,
        defaultProbability: form.defaultProbability,
        kind: form.kind,
        staleAfterDays: form.kind === "open" ? staleDays(form.staleAfterDays) : null,
        pipelineId,
      });
      if (!result.ok) {
        refused(result.reason);
        return;
      }
      setStages((prev) => [...prev, result.stage]);
      toast.success(t("createSuccess"));
      setAddOpen(false);
    } catch {
      toast.error(t("createFailed"));
    } finally {
      setIsPending(false);
    }
  };

  const handleEdit = async () => {
    if (!editStage || !form.name.trim()) return;
    setIsPending(true);
    try {
      const result = await updatePipelineStage(editStage.id, {
        name: form.name,
        color: form.color,
        defaultProbability: form.defaultProbability,
        kind: form.kind,
        staleAfterDays: form.kind === "open" ? staleDays(form.staleAfterDays) : null,
      });
      if (!result.ok) {
        refused(result.reason);
        return;
      }
      setStages((prev) =>
        prev.map((s) =>
          s.id === editStage.id
            ? {
                ...s,
                name: form.name,
                color: form.color,
                defaultProbability: form.defaultProbability,
                isWon: form.kind === "won",
                isLost: form.kind === "lost",
                staleAfterDays: form.kind === "open" ? staleDays(form.staleAfterDays) : null,
              }
            : s,
        ),
      );
      toast.success(t("updateSuccess"));
      setEditStage(null);
    } catch {
      toast.error(t("updateFailed"));
    } finally {
      setIsPending(false);
    }
  };

  const handleDelete = async (stage: Stage) => {
    try {
      await deletePipelineStage(stage.id);
      setStages((prev) => prev.filter((s) => s.id !== stage.id));
      toast.success(t("deleteSuccess"));
    } catch {
      toast.error(t("deleteFailed"));
    }
  };

  const handleMove = async (index: number, direction: "up" | "down") => {
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= stages.length) return;

    const updated = [...stages];
    const a = { ...updated[index] };
    const b = { ...updated[swapIndex] };
    const tmpOrder = a.order;
    a.order = b.order;
    b.order = tmpOrder;
    updated[index] = b;
    updated[swapIndex] = a;
    updated.sort((x, y) => x.order - y.order);
    setStages(updated);

    try {
      await Promise.all([updatePipelineStage(a.id, { order: a.order }), updatePipelineStage(b.id, { order: b.order })]);
    } catch {
      setStages([...initialStages].sort((x, y) => x.order - y.order));
      toast.error(t("updateFailed"));
    }
  };

  return (
    <div className="space-y-6">
      {/* ⚠️ Wrapping, not shrinking. `min-w-0` stopped the button being pushed off
          the screen, and then the subtitle took its place: three lines of caption
          squeezed into 140px beside a button. The button drops to its own line on
          a phone, and the sentence gets the width it was written for. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-bold text-2xl tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Button onClick={openAdd}>
          <Plus className="mr-2 h-4 w-4" />
          {t("addStage")}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("stageCount", { count: stages.length })}</CardDescription>
        </CardHeader>
        <CardContent>
          {stages.length === 0 ? (
            <p className="py-6 text-center text-muted-foreground text-sm">{t("noStages")}</p>
          ) : (
            <div className="space-y-2">
              {stages.map((stage, index) => (
                // ⚠️ Below sm the four row buttons take a line of their own. Side by
                // side with the name they needed 150px of a 250px row, and the name —
                // the only thing that says which stage this is — got what was left,
                // which on a phone was nothing. On that line they are always shown:
                // a row of blank space waiting for a hover is not a layout.
                <div
                  key={stage.id}
                  className="group flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-background px-3 py-2.5 sm:flex-nowrap"
                >
                  <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground/40" />
                  <span
                    className="h-3.5 w-3.5 shrink-0 rounded-full border border-border/50"
                    style={{ background: stage.color ?? "#94a3b8" }}
                  />
                  <span className="min-w-0 flex-1 break-words font-medium text-sm">{stage.name}</span>
                  {kindOf(stage) !== "open" && (
                    <Badge
                      variant="outline"
                      className={
                        stage.isWon
                          ? "shrink-0 border-emerald-500/40 text-emerald-700 text-xs dark:text-emerald-400"
                          : "shrink-0 border-red-500/40 text-red-700 text-xs dark:text-red-400"
                      }
                    >
                      {t(`kind.${kindOf(stage)}`)}
                    </Badge>
                  )}
                  <Badge variant="outline" className="shrink-0 text-xs">
                    {stage.defaultProbability ?? 0}%
                  </Badge>
                  <div className="flex w-full items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100 max-sm:opacity-100 sm:w-auto">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-9 sm:size-7"
                      onClick={() => handleMove(index, "up")}
                      disabled={index === 0}
                      title={t("moveUp")}
                      aria-label={t("moveUp")}
                    >
                      <ChevronUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-9 sm:size-7"
                      onClick={() => handleMove(index, "down")}
                      disabled={index === stages.length - 1}
                      title={t("moveDown")}
                      aria-label={t("moveDown")}
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-9 sm:size-7"
                      onClick={() => openEdit(stage)}
                      title={t("dialog.editTitle")}
                      aria-label={t("dialog.editTitle")}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-9 text-destructive hover:text-destructive sm:size-7"
                      onClick={() => setDeleting(stage)}
                      title={tc("delete")}
                      aria-label={tc("delete")}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={!!deleting}
        onOpenChange={(v) => {
          if (!v) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteTitle", { name: deleting?.name ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>{t("deleteConfirm")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => {
                if (deleting) void handleDelete(deleting);
                setDeleting(null);
              }}
            >
              {tc("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <LossReasonsCard reasons={lossReasons} />

      {/* Add dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("dialog.addTitle")}</DialogTitle>
          </DialogHeader>
          <StageFormFields form={form} onChange={setForm} t={t} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button onClick={handleAdd} disabled={isPending || !form.name.trim()}>
              {isPending ? t("dialog.creating") : t("dialog.createStage")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog
        open={!!editStage}
        onOpenChange={(v) => {
          if (!v) setEditStage(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("dialog.editTitle")}</DialogTitle>
          </DialogHeader>
          <StageFormFields form={form} onChange={setForm} t={t} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditStage(null)}>
              {tc("cancel")}
            </Button>
            <Button onClick={handleEdit} disabled={isPending || !form.name.trim()}>
              {isPending ? t("dialog.saving") : t("dialog.saveChanges")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StageFormFields({
  form,
  onChange,
  t,
}: {
  form: StageForm;
  onChange: (f: StageForm) => void;
  t: ReturnType<typeof useTranslations<"settings.pipeline">>;
}) {
  return (
    <div className="space-y-4 py-2">
      <div className="space-y-1.5">
        <Label>{t("dialog.nameLabel")}</Label>
        <Input
          placeholder={t("dialog.namePlaceholder")}
          value={form.name}
          onChange={(e) => onChange({ ...form, name: e.target.value })}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>{t("dialog.colorLabel")}</Label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={form.color}
              onChange={(e) => onChange({ ...form, color: e.target.value })}
              className="h-9 w-14 cursor-pointer rounded-md border border-input bg-background p-1"
            />
            <span className="font-mono text-muted-foreground text-xs">{form.color}</span>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>{t("dialog.probabilityLabel")}</Label>
          <Input
            type="number"
            min={0}
            max={100}
            value={form.defaultProbability}
            onChange={(e) =>
              onChange({ ...form, defaultProbability: Math.min(100, Math.max(0, Number(e.target.value))) })
            }
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>{t("dialog.kindLabel")}</Label>
        <Select value={form.kind} onValueChange={(v) => onChange({ ...form, kind: v as StageKind })}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STAGE_KINDS.map((k) => (
              <SelectItem key={k} value={k}>
                {t(`kind.${k}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-xs">{t("dialog.kindHelp")}</p>
      </div>
      {form.kind === "open" && (
        <div className="space-y-1.5">
          <Label htmlFor="stage-stale">{t("dialog.staleLabel")}</Label>
          <Input
            id="stage-stale"
            type="number"
            min={1}
            max={365}
            placeholder={t("dialog.stalePlaceholder")}
            value={form.staleAfterDays}
            onChange={(e) => onChange({ ...form, staleAfterDays: e.target.value })}
            className="sm:max-w-40"
          />
          <p className="text-muted-foreground text-xs">{t("dialog.staleHelp")}</p>
        </div>
      )}
    </div>
  );
}
