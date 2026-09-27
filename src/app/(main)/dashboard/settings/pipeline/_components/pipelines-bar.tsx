"use client";

import { useState, useTransition } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { createPipelineAction, deletePipelineAction, renamePipelineAction } from "@/actions/pipeline";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * The workspace's pipelines as tabs above their stages (src/lib/pipelines.ts): a new one
 * starts with the default stages, the default one cannot be deleted, and one with deals in
 * it cannot either — its deals would have nowhere to stand.
 */
export function PipelinesBar({ pipelines, current }: { pipelines: { id: string; name: string }[]; current: string }) {
  const t = useTranslations("settings.pipeline.pipelines");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<null | { mode: "new" | "rename"; name: string }>(null);
  const currentName = pipelines.find((p) => p.id === current)?.name ?? "";

  const save = () =>
    startTransition(async () => {
      if (!dialog) return;
      if (dialog.mode === "new") {
        const result = await createPipelineAction(dialog.name).catch(() => null);
        if (!result?.ok) {
          toast.error(t("failed"));
          return;
        }
        setDialog(null);
        router.push(`/dashboard/settings/pipeline?pipeline=${result.id}`);
        router.refresh();
        return;
      }
      const result = await renamePipelineAction(current, dialog.name).catch(() => null);
      if (!result?.ok) {
        toast.error(t("failed"));
        return;
      }
      setDialog(null);
      router.refresh();
    });

  const remove = () =>
    startTransition(async () => {
      const result = await deletePipelineAction(current).catch(() => null);
      if (!result) {
        toast.error(t("failed"));
        return;
      }
      if (!result.ok) {
        toast.error(t(`refused.${result.reason}`));
        return;
      }
      router.push("/dashboard/settings/pipeline");
      router.refresh();
    });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label={t("label")} className="scrollbar-slim -mx-1 min-w-0 flex-1 overflow-x-auto px-1">
          <ul className="flex min-w-max gap-1 border-b">
            {pipelines.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/dashboard/settings/pipeline?pipeline=${p.id}`}
                  aria-current={p.id === current ? "page" : undefined}
                  className={cn(
                    "-mb-px inline-flex border-b-2 px-3 py-2 font-medium text-sm",
                    p.id === current
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {p.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex shrink-0 gap-1">
          <Button variant="ghost" size="sm" onClick={() => setDialog({ mode: "rename", name: currentName })}>
            <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            {t("rename")}
          </Button>
          {current !== "default" && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm" className="text-destructive" disabled={pending}>
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  {t("delete")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("deleteTitle", { name: currentName })}</AlertDialogTitle>
                  <AlertDialogDescription>{t("deleteBody")}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
                  <AlertDialogAction onClick={remove}>{t("delete")}</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          <Button variant="outline" size="sm" onClick={() => setDialog({ mode: "new", name: "" })}>
            <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            {t("new")}
          </Button>
        </div>
      </div>
      {pipelines.length === 1 && <p className="text-muted-foreground text-xs">{t("oneHelp")}</p>}

      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog?.mode === "new" ? t("newTitle") : t("renameTitle")}</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <Label htmlFor="pipeline-name">{t("name")}</Label>
            <Input
              id="pipeline-name"
              autoFocus
              maxLength={80}
              value={dialog?.name ?? ""}
              onChange={(e) => dialog && setDialog({ ...dialog, name: e.target.value })}
            />
            {dialog?.mode === "new" && <p className="text-muted-foreground text-xs">{t("newHelp")}</p>}
            <DialogFooter>
              <Button type="submit" disabled={pending || !dialog?.name.trim()}>
                {dialog?.mode === "new" ? t("create") : tc("save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
