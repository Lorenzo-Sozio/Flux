"use client";

import { useState, useTransition } from "react";

import Link from "next/link";

import { Check, ChevronRight, GitMerge, Pencil, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import {
  deleteListEntryAction,
  type ListEntry,
  type ListKind,
  mergeListEntryAction,
  renameListEntryAction,
} from "@/actions/lists";
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
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * Settings → Lists: the values people pick from on a company, kept tidy in one place.
 * Loss reasons live beside the pipeline stages they belong to, and are linked from here.
 */
export function ListsClient({ lists }: { lists: Record<ListKind, ListEntry[]> }) {
  const t = useTranslations("settings.lists");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-bold text-2xl tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>
      <ListCard kind="category" initial={lists.category} />
      <ListCard kind="type" initial={lists.type} />
      <Link href="/dashboard/settings/pipeline">
        <Card className="transition-shadow hover:shadow-md">
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <CardTitle className="text-base">{t("lossReasons.title")}</CardTitle>
              <CardDescription>{t("lossReasons.help")}</CardDescription>
            </div>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </CardHeader>
        </Card>
      </Link>
    </div>
  );
}

function ListCard({ kind, initial }: { kind: ListKind; initial: ListEntry[] }) {
  const t = useTranslations("settings.lists");
  const [entries, setEntries] = useState(initial);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [merging, setMerging] = useState<{ from: ListEntry; into: string } | null>(null);
  const [deleting, setDeleting] = useState<ListEntry | null>(null);
  const [pending, startTransition] = useTransition();

  const refused = (reason: string): void => {
    toast.error(t(`refused.${reason}`));
  };

  const rename = (id: string, name: string) =>
    startTransition(async () => {
      const result = await renameListEntryAction(kind, id, name);
      if (!result.ok) return refused(result.reason);
      setEntries((prev) =>
        prev.map((e) => (e.id === id ? { ...e, name: name.trim() } : e)).sort((a, b) => a.name.localeCompare(b.name)),
      );
      setEditing(null);
      toast.success(t("saved"));
    });

  const merge = (from: ListEntry, intoId: string) =>
    startTransition(async () => {
      const result = await mergeListEntryAction(kind, from.id, intoId);
      if (!result.ok) return refused(result.reason);
      setEntries((prev) =>
        prev
          .filter((e) => e.id !== from.id)
          .map((e) => (e.id === intoId ? { ...e, companies: e.companies + from.companies } : e)),
      );
      setMerging(null);
      toast.success(t("merged"));
    });

  const remove = (entry: ListEntry) =>
    startTransition(async () => {
      try {
        await deleteListEntryAction(kind, entry.id);
        setEntries((prev) => prev.filter((e) => e.id !== entry.id));
        toast.success(t("deleted"));
      } catch {
        toast.error(t("failed"));
      }
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t(`${kind}.title`)}</CardTitle>
        <CardDescription>{t(`${kind}.help`)}</CardDescription>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("empty")}</p>
        ) : (
          <ul className="space-y-2">
            {entries.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2">
                {editing?.id === entry.id ? (
                  <form
                    className="flex min-w-0 flex-1 items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      rename(entry.id, editing.name);
                    }}
                  >
                    <Input
                      autoFocus
                      value={editing.name}
                      onChange={(e) => setEditing({ id: entry.id, name: e.target.value })}
                      aria-label={t("rename")}
                    />
                    <Button type="submit" size="icon" variant="ghost" className="size-9 shrink-0" disabled={pending}>
                      <Check className="size-4" />
                      <span className="sr-only">{t("save")}</span>
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-9 shrink-0"
                      onClick={() => setEditing(null)}
                    >
                      <X className="size-4" />
                      <span className="sr-only">{t("cancel")}</span>
                    </Button>
                  </form>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 break-words text-sm">{entry.name}</span>
                    <Badge variant="outline" className="shrink-0 text-xs">
                      {t("companies", { count: entry.companies })}
                    </Badge>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-9 sm:size-7"
                        onClick={() => setEditing({ id: entry.id, name: entry.name })}
                        title={t("rename")}
                        aria-label={t("rename")}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-9 sm:size-7"
                        disabled={entries.length < 2}
                        onClick={() => setMerging({ from: entry, into: "" })}
                        title={t("merge")}
                        aria-label={t("merge")}
                      >
                        <GitMerge className="size-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-9 text-destructive hover:text-destructive sm:size-7"
                        onClick={() => setDeleting(entry)}
                        title={t("delete")}
                        aria-label={t("delete")}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <AlertDialog
        open={!!merging}
        onOpenChange={(v) => {
          if (!v) setMerging(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("mergeTitle", { name: merging?.from.name ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>{t("mergeHelp", { count: merging?.from.companies ?? 0 })}</AlertDialogDescription>
          </AlertDialogHeader>
          <Select value={merging?.into ?? ""} onValueChange={(v) => merging && setMerging({ ...merging, into: v })}>
            <SelectTrigger className="w-full" aria-label={t("mergeInto")}>
              <SelectValue placeholder={t("mergeInto")} />
            </SelectTrigger>
            <SelectContent>
              {entries
                .filter((e) => e.id !== merging?.from.id)
                .map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={!merging?.into || pending}
              onClick={() => merging?.into && merge(merging.from, merging.into)}
            >
              {t("merge")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!deleting}
        onOpenChange={(v) => {
          if (!v) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteTitle", { name: deleting?.name ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>{t("deleteHelp", { count: deleting?.companies ?? 0 })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => {
                if (deleting) remove(deleting);
                setDeleting(null);
              }}
            >
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
