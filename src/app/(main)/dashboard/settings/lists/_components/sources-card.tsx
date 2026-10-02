"use client";

import { useState, useTransition } from "react";

import { ArrowDown, ArrowUp, Check, GitMerge, ListPlus, Pencil, Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import {
  createRecordSourceAction,
  listSourceValueAction,
  mergeRecordSourceAction,
  renameRecordSourceAction,
  reorderRecordSourcesAction,
  type SourceUsage,
  type SourceWriteResult,
  setRecordSourceActiveAction,
} from "@/actions/record-sources";
import { forgetRecordSources } from "@/components/crm/source-select";
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
import { Switch } from "@/components/ui/switch";
import { type RecordSource, sourceLabel } from "@/lib/record-sources";

/**
 * Settings → Lists → Sources: where customers come from, the same values on every record
 * (src/lib/record-sources.ts). Renaming keeps every record where it is; retiring stops the
 * forms offering a source and keeps it on the records already filed under it; merging moves
 * them. Values on records that nobody listed — typed before the list, or sent by an
 * integration — are shown below, to list or merge.
 */
export function SourcesCard({ initial, usage }: { initial: RecordSource[]; usage: SourceUsage[] }) {
  const t = useTranslations("settings.lists.sources");
  const tl = useTranslations("settings.lists");
  const tSources = useTranslations("common.sources");
  const [sources, setSources] = useState(() => [...initial].sort((a, b) => a.order - b.order));
  const [counts, setCounts] = useState(() => new Map(usage.map((u) => [u.value, u.records])));
  const [editing, setEditing] = useState<{ key: string; name: string } | null>(null);
  const [adding, setAdding] = useState("");
  const [merging, setMerging] = useState<{ from: string; into: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const label = (key: string) => sourceLabel(key, sources, (k) => tSources(k)) ?? key;
  const listed = new Set(sources.map((s) => s.key));
  const unlisted = [...counts.entries()].filter(([value]) => !listed.has(value));

  /** Every change here changes what the forms offer: they read the list again on next opening. */
  const done = (result: SourceWriteResult, message: string): boolean => {
    if (!result.ok) {
      toast.error(tl(`refused.${result.reason}`));
      return false;
    }
    forgetRecordSources();
    toast.success(message);
    return true;
  };

  const add = () =>
    startTransition(async () => {
      const name = adding.trim();
      const result = await createRecordSourceAction(name);
      if (!done(result, tl("saved")) || !result.ok) return;
      setSources((prev) => [...prev, { key: result.key, name, order: prev.length + 1, isActive: true }]);
      setAdding("");
    });

  const rename = (key: string, name: string) =>
    startTransition(async () => {
      if (!done(await renameRecordSourceAction(key, name), tl("saved"))) return;
      setSources((prev) => prev.map((s) => (s.key === key ? { ...s, name: name.trim() } : s)));
      setEditing(null);
    });

  const toggle = (key: string, isActive: boolean) =>
    startTransition(async () => {
      try {
        await setRecordSourceActiveAction(key, isActive);
        forgetRecordSources();
        setSources((prev) => prev.map((s) => (s.key === key ? { ...s, isActive } : s)));
      } catch {
        toast.error(tl("failed"));
      }
    });

  const move = (index: number, by: -1 | 1) =>
    startTransition(async () => {
      const next = [...sources];
      const [row] = next.splice(index, 1);
      next.splice(index + by, 0, row);
      const ordered = next.map((s, i) => ({ ...s, order: i + 1 }));
      setSources(ordered);
      try {
        await reorderRecordSourcesAction(ordered.map((s) => s.key));
        forgetRecordSources();
      } catch {
        toast.error(tl("failed"));
      }
    });

  const list = (value: string) =>
    startTransition(async () => {
      const result = await listSourceValueAction(value);
      if (!done(result, tl("saved"))) return;
      setSources((prev) => [...prev, { key: value, name: value, order: prev.length + 1, isActive: true }]);
    });

  const merge = (from: string, into: string) =>
    startTransition(async () => {
      if (!done(await mergeRecordSourceAction(from, into), tl("merged"))) return;
      setSources((prev) => prev.filter((s) => s.key !== from));
      setCounts((prev) => {
        const next = new Map(prev);
        next.set(into, (next.get(into) ?? 0) + (next.get(from) ?? 0));
        next.delete(from);
        return next;
      });
      setMerging(null);
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("help")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="space-y-2">
          {sources.map((s, i) => (
            <li key={s.key} className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2">
              {editing?.key === s.key ? (
                <form
                  className="flex min-w-0 flex-1 items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    rename(s.key, editing.name);
                  }}
                >
                  <Input
                    autoFocus
                    value={editing.name}
                    onChange={(e) => setEditing({ key: s.key, name: e.target.value })}
                    aria-label={tl("rename")}
                  />
                  <Button type="submit" size="icon" variant="ghost" className="size-9 shrink-0" disabled={pending}>
                    <Check className="size-4" />
                    <span className="sr-only">{tl("save")}</span>
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-9 shrink-0"
                    onClick={() => setEditing(null)}
                  >
                    <X className="size-4" />
                    <span className="sr-only">{tl("cancel")}</span>
                  </Button>
                </form>
              ) : (
                <>
                  <span className={`min-w-0 flex-1 break-words text-sm ${s.isActive ? "" : "text-muted-foreground"}`}>
                    {label(s.key)}
                  </span>
                  {!s.isActive && (
                    <Badge variant="secondary" className="shrink-0 text-xs">
                      {t("retired")}
                    </Badge>
                  )}
                  <Badge variant="outline" className="shrink-0 text-xs">
                    {t("records", { count: counts.get(s.key) ?? 0 })}
                  </Badge>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-9 sm:size-7"
                      disabled={i === 0 || pending}
                      onClick={() => move(i, -1)}
                      aria-label={t("moveUp")}
                      title={t("moveUp")}
                    >
                      <ArrowUp className="size-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-9 sm:size-7"
                      disabled={i === sources.length - 1 || pending}
                      onClick={() => move(i, 1)}
                      aria-label={t("moveDown")}
                      title={t("moveDown")}
                    >
                      <ArrowDown className="size-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-9 sm:size-7"
                      onClick={() => setEditing({ key: s.key, name: label(s.key) })}
                      aria-label={tl("rename")}
                      title={tl("rename")}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-9 sm:size-7"
                      disabled={sources.length < 2}
                      onClick={() => setMerging({ from: s.key, into: "" })}
                      aria-label={tl("merge")}
                      title={tl("merge")}
                    >
                      <GitMerge className="size-3.5" />
                    </Button>
                    <Switch
                      checked={s.isActive}
                      onCheckedChange={(v) => toggle(s.key, v)}
                      disabled={pending}
                      aria-label={t("active", { name: label(s.key) })}
                    />
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>

        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <Input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder={t("newPlaceholder")} />
          <Button type="submit" variant="outline" className="shrink-0 gap-1.5" disabled={pending || !adding.trim()}>
            <Plus className="size-4" aria-hidden />
            {t("add")}
          </Button>
        </form>

        {unlisted.length > 0 && (
          <div className="space-y-2 rounded-lg border border-dashed p-3">
            <p className="font-medium text-sm">{t("unlistedTitle")}</p>
            <p className="text-muted-foreground text-xs">{t("unlistedHelp")}</p>
            <ul className="space-y-2">
              {unlisted.map(([value, n]) => (
                <li key={value} className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 break-words text-sm">{label(value)}</span>
                  <Badge variant="outline" className="shrink-0 text-xs">
                    {t("records", { count: n })}
                  </Badge>
                  <Button size="sm" variant="ghost" className="gap-1.5" disabled={pending} onClick={() => list(value)}>
                    <ListPlus className="size-3.5" aria-hidden />
                    {t("addToList")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1.5"
                    disabled={pending}
                    onClick={() => setMerging({ from: value, into: "" })}
                  >
                    <GitMerge className="size-3.5" aria-hidden />
                    {tl("merge")}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
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
            <AlertDialogTitle>{tl("mergeTitle", { name: merging ? label(merging.from) : "" })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("mergeHelp", { count: merging ? (counts.get(merging.from) ?? 0) : 0 })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Select value={merging?.into ?? ""} onValueChange={(v) => merging && setMerging({ ...merging, into: v })}>
            <SelectTrigger className="w-full" aria-label={tl("mergeInto")}>
              <SelectValue placeholder={tl("mergeInto")} />
            </SelectTrigger>
            <SelectContent>
              {sources
                .filter((s) => s.key !== merging?.from)
                .map((s) => (
                  <SelectItem key={s.key} value={s.key}>
                    {label(s.key)}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <AlertDialogFooter>
            <AlertDialogCancel>{tl("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={!merging?.into || pending}
              onClick={() => merging?.into && merge(merging.from, merging.into)}
            >
              {tl("merge")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
