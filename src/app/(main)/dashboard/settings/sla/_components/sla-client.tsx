"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Clock, ShieldAlert, Loader2 } from "lucide-react";
import { createSlaAction, updateSlaAction, deleteSlaAction, toggleSlaAction } from "@/actions/sla";
import { SlaSchema } from "@/actions/sla-validation";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Sla = {
  id: string;
  name: string;
  description: string | null;
  priority: string;
  firstResponseTimeMinutes: number;
  resolutionTimeMinutes: number;
  isActive: boolean;
  createdAt: Date;
};

type FormValues = z.infer<typeof SlaSchema>;

const PRIORITY_CONFIG: Record<string, { label: string; className: string }> = {
  low:    { label: "Low",    className: "border-slate-300 text-slate-600" },
  normal: { label: "Normal", className: "border-blue-300 text-blue-600 bg-blue-50" },
  high:   { label: "High",   className: "border-amber-300 text-amber-600 bg-amber-50" },
  urgent: { label: "Urgent", className: "border-red-300 text-red-600 bg-red-50" },
};

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

interface Props {
  slas: Sla[];
}

export function SlaClient({ slas: initial }: Props) {
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
      isActive: sla.isActive,
    });
    setDialogOpen(true);
  }

  async function onSubmit(data: FormValues) {
    try {
      if (editTarget) {
        await updateSlaAction(editTarget.id, data);
        setSlas((prev) => prev.map((s) => s.id === editTarget.id ? { ...s, ...data } : s));
        toast.success("SLA updated");
      } else {
        await createSlaAction(data);
        toast.success("SLA created");
        // Refresh by reloading — simplest since we don't get the new ID back
        window.location.reload();
      }
      setDialogOpen(false);
    } catch {
      toast.error("Failed to save SLA");
    }
  }

  function handleToggle(sla: Sla, isActive: boolean) {
    startTransition(async () => {
      try {
        await toggleSlaAction(sla.id, isActive);
        setSlas((prev) => prev.map((s) => s.id === sla.id ? { ...s, isActive } : s));
      } catch {
        toast.error("Failed to update SLA");
      }
    });
  }

  function handleDelete() {
    if (!deleteTarget) return;
    startTransition(async () => {
      try {
        await deleteSlaAction(deleteTarget.id);
        setSlas((prev) => prev.filter((s) => s.id !== deleteTarget.id));
        toast.success("SLA deleted");
      } catch {
        toast.error("Failed to delete SLA");
      } finally {
        setDeleteTarget(null);
      }
    });
  }

  return (
    <>
      <Card className="border-0 shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <div>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-primary" />
              SLA Policies
            </CardTitle>
            <CardDescription className="text-sm mt-1">
              Each policy maps a ticket priority to response and resolution targets.
            </CardDescription>
          </div>
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            New SLA
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {slas.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Clock className="h-10 w-10 text-muted-foreground/40 mb-3" />
              <p className="text-sm font-medium text-muted-foreground">No SLA policies defined</p>
              <p className="text-xs text-muted-foreground mt-1">
                Create your first policy to start tracking ticket response times.
              </p>
              <Button size="sm" className="mt-4" onClick={openCreate}>
                <Plus className="mr-2 h-4 w-4" />
                New SLA
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="text-xs font-semibold">Name</TableHead>
                  <TableHead className="text-xs font-semibold">Priority</TableHead>
                  <TableHead className="text-xs font-semibold text-right">First Response</TableHead>
                  <TableHead className="text-xs font-semibold text-right">Resolution</TableHead>
                  <TableHead className="text-xs font-semibold text-center">Active</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {slas.map((sla) => {
                  const cfg = PRIORITY_CONFIG[sla.priority] ?? PRIORITY_CONFIG.normal;
                  return (
                    <TableRow key={sla.id}>
                      <TableCell>
                        <div className="font-medium text-sm">{sla.name}</div>
                        {sla.description && (
                          <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                            {sla.description}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-xs ${cfg.className}`}>
                          {cfg.label}
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
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => openEdit(sla)}
                          >
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

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editTarget ? "Edit SLA Policy" : "New SLA Policy"}</DialogTitle>
            <DialogDescription>
              Set response and resolution time targets in minutes.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-1">
            <div className="space-y-2">
              <Label>Name <span className="text-destructive">*</span></Label>
              <Input placeholder="e.g. Standard SLA" {...form.register("name")} />
              {form.formState.errors.name && (
                <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                placeholder="Optional notes about this policy…"
                rows={2}
                className="resize-none text-sm"
                {...form.register("description")}
              />
            </div>

            <div className="space-y-2">
              <Label>Priority <span className="text-destructive">*</span></Label>
              <Select
                value={form.watch("priority")}
                onValueChange={(v) => form.setValue("priority", v as FormValues["priority"])}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select priority" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
              {form.formState.errors.priority && (
                <p className="text-xs text-destructive">{form.formState.errors.priority.message}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>First Response (min) <span className="text-destructive">*</span></Label>
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
                <Label>Resolution (min) <span className="text-destructive">*</span></Label>
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

            <div className="flex items-center gap-3">
              <Switch
                checked={form.watch("isActive")}
                onCheckedChange={(v) => form.setValue("isActive", v)}
              />
              <Label className="cursor-pointer">Active</Label>
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {editTarget ? "Save Changes" : "Create SLA"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete SLA Policy</AlertDialogTitle>
            <AlertDialogDescription>
              Delete <strong>{deleteTarget?.name}</strong>? Tickets currently using this policy will lose their SLA target.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
              disabled={isPending}
            >
              {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
