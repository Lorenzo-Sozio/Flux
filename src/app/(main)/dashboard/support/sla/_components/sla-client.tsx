"use client";

import { useState, useTransition } from "react";

import { zodResolver } from "@hookform/resolvers/zod";
import { Clock, Loader2, Pencil, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { createSlaAction, deleteSlaAction, toggleSlaAction, updateSlaAction } from "@/actions/sla";
import { SlaSchema } from "@/actions/sla-validation";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

type Sla = {
  id: string;
  name: string;
  description: string | null;
  priority: string;
  firstResponseTimeMinutes: number;
  resolutionTimeMinutes: number;
  useBusinessHours: boolean;
  escalationGroupId: string | null;
  isActive: boolean;
  createdAt: Date;
};

type Group = { id: string; name: string; memberCount: number };

/** The select needs a value for "nobody", and an empty string is not one. */
const NO_GROUP = "__none__";

type FormValues = z.infer<typeof SlaSchema>;
type PriorityKey = "low" | "normal" | "high" | "urgent";

const PRIORITY_CLASSNAMES: Record<string, string> = {
  low: "border-slate-300 text-slate-600",
  normal: "border-blue-300 text-blue-600 bg-blue-50",
  high: "border-amber-300 text-amber-600 bg-amber-50",
  urgent: "border-red-300 text-red-600 bg-red-50",
};

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

interface Props {
  slas: Sla[];
  groups: Group[];
}

export function SlaClient({ slas: initial, groups }: Props) {
  const t = useTranslations("support.sla");
  const tc = useTranslations("common");
  const [slas, setSlas] = useState(initial);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Sla | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Sla | null>(null);
  const [isPending, startTransition] = useTransition();

  const form = useForm<FormValues>({
    resolver: zodResolver(SlaSchema),
    defaultValues: {
      name: "",
      description: "",
      priority: "normal",
      firstResponseTimeMinutes: 60,
      resolutionTimeMinutes: 480,
      useBusinessHours: false,
      escalationGroupId: null,
      isActive: true,
    },
  });

  function openCreate() {
    setEditTarget(null);
    form.reset({
      name: "",
      description: "",
      priority: "normal",
      firstResponseTimeMinutes: 60,
      resolutionTimeMinutes: 480,
      useBusinessHours: false,
      escalationGroupId: null,
      isActive: true,
    });
    setDialogOpen(true);
  }

  function openEdit(sla: Sla) {
    setEditTarget(sla);
    form.reset({
      name: sla.name,
      description: sla.description ?? "",
      priority: sla.priority as FormValues["priority"],
      firstResponseTimeMinutes: sla.firstResponseTimeMinutes,
      resolutionTimeMinutes: sla.resolutionTimeMinutes,
      useBusinessHours: sla.useBusinessHours,
      escalationGroupId: sla.escalationGroupId,
      isActive: sla.isActive,
    });
    setDialogOpen(true);
  }

  async function onSubmit(data: FormValues) {
    try {
      if (editTarget) {
        await updateSlaAction(editTarget.id, data);
        setSlas((prev) => prev.map((s) => (s.id === editTarget.id ? { ...s, ...data } : s)));
        toast.success(t("updateSuccess"));
      } else {
        await createSlaAction(data);
        toast.success(t("createSuccess"));
        window.location.reload();
      }
      setDialogOpen(false);
    } catch {
      toast.error(t("saveFailed"));
    }
  }

  function handleToggle(sla: Sla, isActive: boolean) {
    startTransition(async () => {
      try {
        await toggleSlaAction(sla.id, isActive);
        setSlas((prev) => prev.map((s) => (s.id === sla.id ? { ...s, isActive } : s)));
      } catch {
        toast.error(t("updateFailed"));
      }
    });
  }

  function handleDelete() {
    if (!deleteTarget) return;
    startTransition(async () => {
      try {
        await deleteSlaAction(deleteTarget.id);
        setSlas((prev) => prev.filter((s) => s.id !== deleteTarget.id));
        toast.success(t("deleteSuccess"));
      } catch {
        toast.error(t("deleteFailed"));
      } finally {
        setDeleteTarget(null);
      }
    });
  }

  return (
    <>
      <Card className="border-0 shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4 gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-primary" />
              {t("policies")}
            </CardTitle>
            <CardDescription className="text-sm mt-1">{t("policiesDescription")}</CardDescription>
          </div>
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            {t("newSla")}
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {slas.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Clock className="h-10 w-10 text-muted-foreground/40 mb-3" />
              <p className="text-sm font-medium text-muted-foreground">{t("noSlasYet")}</p>
              <p className="text-xs text-muted-foreground mt-1">{t("noSlasDesc")}</p>
              <Button size="sm" className="mt-4" onClick={openCreate}>
                <Plus className="mr-2 h-4 w-4" />
                {t("newSla")}
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="text-xs font-semibold">{t("columns.name")}</TableHead>
                  <TableHead className="text-xs font-semibold">{t("columns.priority")}</TableHead>
                  <TableHead className="text-xs font-semibold text-right">{t("columns.firstResponse")}</TableHead>
                  <TableHead className="text-xs font-semibold text-right">{t("columns.resolution")}</TableHead>
                  <TableHead className="text-xs font-semibold text-center">{t("columns.active")}</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {slas.map((sla) => {
                  const className = PRIORITY_CLASSNAMES[sla.priority] ?? PRIORITY_CLASSNAMES.normal;
                  return (
                    <TableRow key={sla.id}>
                      <TableCell>
                        <div className="font-medium text-sm">{sla.name}</div>
                        {sla.description && (
                          <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{sla.description}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-xs ${className}`}>
                          {t(`priorities.${sla.priority as PriorityKey}`)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums font-medium">
                        {formatMinutes(sla.firstResponseTimeMinutes)}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums font-medium">
                        {formatMinutes(sla.resolutionTimeMinutes)}
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch
                          checked={sla.isActive}
                          disabled={isPending}
                          onCheckedChange={(v) => handleToggle(sla, v)}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(sla)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                            onClick={() => setDeleteTarget(sla)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editTarget ? t("dialog.titleEdit") : t("dialog.titleCreate")}</DialogTitle>
            <DialogDescription>{t("dialog.description")}</DialogDescription>
          </DialogHeader>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-1">
            <div className="space-y-2">
              <Label>
                {t("columns.name")} <span className="text-destructive">*</span>
              </Label>
              <Input placeholder={t("dialog.namePlaceholder")} {...form.register("name")} />
              {form.formState.errors.name && (
                <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label>{t("dialog.descriptionLabel")}</Label>
              <Textarea
                placeholder={t("dialog.descPlaceholder")}
                rows={2}
                className="resize-none text-sm"
                {...form.register("description")}
              />
            </div>

            <div className="space-y-2">
              <Label>
                {t("dialog.priorityLabel")} <span className="text-destructive">*</span>
              </Label>
              <Select
                value={form.watch("priority")}
                onValueChange={(v) => form.setValue("priority", v as FormValues["priority"])}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("dialog.selectPriority")} />
                </SelectTrigger>
                <SelectContent>
                  {(["low", "normal", "high", "urgent"] as PriorityKey[]).map((p) => (
                    <SelectItem key={p} value={p}>
                      {t(`priorities.${p}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.formState.errors.priority && (
                <p className="text-xs text-destructive">{form.formState.errors.priority.message}</p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>
                  {t("dialog.firstResponse")} <span className="text-destructive">*</span>
                </Label>
                <Input
                  type="number"
                  min="1"
                  step="1"
                  {...form.register("firstResponseTimeMinutes")}
                  onChange={(e) => form.setValue("firstResponseTimeMinutes", e.target.valueAsNumber)}
                />
                {form.formState.errors.firstResponseTimeMinutes && (
                  <p className="text-xs text-destructive">{form.formState.errors.firstResponseTimeMinutes.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label>
                  {t("dialog.resolution")} <span className="text-destructive">*</span>
                </Label>
                <Input
                  type="number"
                  min="1"
                  step="1"
                  {...form.register("resolutionTimeMinutes")}
                  onChange={(e) => form.setValue("resolutionTimeMinutes", e.target.valueAsNumber)}
                />
                {form.formState.errors.resolutionTimeMinutes && (
                  <p className="text-xs text-destructive">{form.formState.errors.resolutionTimeMinutes.message}</p>
                )}
              </div>
            </div>

            {/* What "four hours" means. The column existed and no form could set
                it, so the clock ran overnight whatever the calendar said. */}
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <Switch
                  checked={form.watch("useBusinessHours")}
                  onCheckedChange={(v) => form.setValue("useBusinessHours", v)}
                />
                <Label className="cursor-pointer">{t("dialog.businessHoursLabel")}</Label>
              </div>
              <p className="text-muted-foreground text-xs">{t("dialog.businessHoursHint")}</p>
            </div>

            <div className="space-y-2">
              <Label>{t("dialog.escalationLabel")}</Label>
              <Select
                value={form.watch("escalationGroupId") ?? NO_GROUP}
                onValueChange={(v) => form.setValue("escalationGroupId", v === NO_GROUP ? null : v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_GROUP}>{t("dialog.escalationNone")}</SelectItem>
                  {groups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name} · {g.memberCount}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">{t("dialog.escalationHint")}</p>
            </div>

            <div className="flex items-center gap-3">
              <Switch checked={form.watch("isActive")} onCheckedChange={(v) => form.setValue("isActive", v)} />
              <Label className="cursor-pointer">{t("dialog.activeLabel")}</Label>
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                {tc("cancel")}
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {editTarget ? t("dialog.saveChanges") : t("dialog.createSla")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteDescription", { name: deleteTarget?.name ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
              disabled={isPending}
            >
              {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {tc("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
