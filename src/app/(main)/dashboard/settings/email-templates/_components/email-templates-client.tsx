"use client";

import { useMemo, useState } from "react";

import { useRouter } from "next/navigation";

import {
  CopyIcon,
  FileTextIcon,
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  SparklesIcon,
  Trash2Icon,
  UsersIcon,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";

import { createStarterTemplatesAction, deleteTemplateAction, saveTemplateAction } from "@/actions/email-templates";
import { RichTextEditor } from "@/components/crm/rich-text-editor";
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
import { Card, CardContent } from "@/components/ui/card";
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
import { PERSONAL_CATEGORIES, type PersonalCategory } from "@/lib/email-template-rules";
import { cn } from "@/lib/utils";

export interface TemplateRow {
  id: string;
  name: string;
  subject: string;
  body: string;
  category: string;
  isPublic: boolean;
  ownerId: string | null;
  ownerName: string | null;
  useCount: number;
  lastUsedAt: Date | string | null;
  editable: boolean;
}

interface Form {
  id?: string;
  name: string;
  category: PersonalCategory;
  subject: string;
  body: string;
  isPublic: boolean;
}

const EMPTY: Form = { name: "", category: "followup", subject: "", body: "", isPublic: false };

function preview(html: string, max = 160): string {
  const text = html
    .replace(/<\/p>|<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function EmailTemplatesClient({
  templates,
  canWrite,
  userId,
}: {
  templates: TemplateRow[];
  canWrite: boolean;
  userId: string;
}) {
  const t = useTranslations("emailTemplates");
  const format = useFormatter();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<PersonalCategory | "all">("all");
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<TemplateRow | null>(null);
  const [starting, setStarting] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return templates.filter(
      (tpl) =>
        (category === "all" || tpl.category === category) &&
        (!q || `${tpl.name} ${tpl.subject} ${preview(tpl.body, 1000)}`.toLowerCase().includes(q)),
    );
  }, [templates, query, category]);
  const mine = filtered.filter((tpl) => tpl.ownerId === userId);
  const team = filtered.filter((tpl) => tpl.ownerId !== userId);
  const categoryLabel = (c: string) =>
    (PERSONAL_CATEGORIES as readonly string[]).includes(c) ? t(`categories.${c}`) : c;

  const save = async () => {
    if (!form) return;
    setSaving(true);
    try {
      const result = await saveTemplateAction(form);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t("saved"));
      setForm(null);
      router.refresh();
    } catch {
      toast.error(t("errors.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    const result = await deleteTemplateAction(deleting.id).catch(() => null);
    setDeleting(null);
    if (!result?.ok) {
      toast.error(result && !result.ok ? result.error : t("errors.deleteFailed"));
      return;
    }
    toast.success(t("deleted"));
    router.refresh();
  };

  const startWithBasics = async () => {
    setStarting(true);
    try {
      const result = await createStarterTemplatesAction();
      if (!result.ok) toast.error(result.error);
      else if (result.created === 0) toast.info(t("startersNone"));
      else {
        toast.success(t("starters.created", { count: result.created }));
        router.refresh();
      }
    } finally {
      setStarting(false);
    }
  };

  const formValid =
    form !== null && form.name.trim() && form.subject.trim() && form.body.replace(/<[^>]+>/g, "").trim();

  const card = (tpl: TemplateRow) => (
    <Card key={tpl.id} className="group">
      <CardContent className="space-y-2 p-4">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{tpl.name}</p>
            <p className="truncate text-muted-foreground text-sm">{tpl.subject}</p>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            {tpl.editable && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t("edit")}
                onClick={() =>
                  setForm({
                    id: tpl.id,
                    name: tpl.name,
                    category: (PERSONAL_CATEGORIES as readonly string[]).includes(tpl.category)
                      ? (tpl.category as PersonalCategory)
                      : "other",
                    subject: tpl.subject,
                    body: tpl.body,
                    isPublic: tpl.isPublic,
                  })
                }
              >
                <PencilIcon />
              </Button>
            )}
            {canWrite && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t("duplicate")}
                onClick={() =>
                  setForm({
                    name: t("copyOf", { name: tpl.name }),
                    category: (PERSONAL_CATEGORIES as readonly string[]).includes(tpl.category)
                      ? (tpl.category as PersonalCategory)
                      : "other",
                    subject: tpl.subject,
                    body: tpl.body,
                    isPublic: false,
                  })
                }
              >
                <CopyIcon />
              </Button>
            )}
            {tpl.editable && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t("delete")}
                onClick={() => setDeleting(tpl)}
              >
                <Trash2Icon />
              </Button>
            )}
          </div>
        </div>
        <p className="line-clamp-2 text-muted-foreground text-xs">{preview(tpl.body)}</p>
        <div className="flex flex-wrap items-center gap-1.5 pt-1 text-muted-foreground text-xs">
          <Badge variant="secondary" className="font-normal">
            {categoryLabel(tpl.category)}
          </Badge>
          {tpl.isPublic && (
            <Badge variant="outline" className="gap-1 font-normal">
              <UsersIcon className="size-3" />
              {t("sharedBadge")}
            </Badge>
          )}
          <span className="ml-auto">
            {tpl.useCount > 0
              ? t("used", {
                  count: tpl.useCount,
                  when: tpl.lastUsedAt ? format.relativeTime(new Date(tpl.lastUsedAt)) : "",
                })
              : t("neverUsed")}
          </span>
        </div>
        {tpl.ownerId !== userId && tpl.ownerName && (
          <p className="text-muted-foreground text-xs">{t("by", { name: tpl.ownerName })}</p>
        )}
      </CardContent>
    </Card>
  );

  return (
    <>
      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <SearchIcon className="-translate-y-1/2 absolute top-1/2 left-3 size-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("search")}
            aria-label={t("search")}
            className="pl-9"
          />
        </div>
        {canWrite && templates.length > 0 && (
          // Adds only the basic templates missing: after an update it brings in the new ones.
          <Button type="button" variant="outline" onClick={startWithBasics} disabled={starting}>
            {starting ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />}
            {t("addStarters")}
          </Button>
        )}
        {canWrite && (
          <Button type="button" onClick={() => setForm({ ...EMPTY })}>
            <PlusIcon />
            {t("new")}
          </Button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {(["all", ...PERSONAL_CATEGORIES] as const).map((c) => (
          <Button
            key={c}
            type="button"
            size="xs"
            variant={category === c ? "secondary" : "ghost"}
            onClick={() => setCategory(c)}
            className={cn(category === c && "font-medium")}
          >
            {c === "all" ? t("allCategories") : t(`categories.${c}`)}
          </Button>
        ))}
      </div>

      {/* ── Lists ───────────────────────────────────────────────────────── */}
      {templates.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <FileTextIcon className="size-5 text-muted-foreground" />
            </div>
            <div className="max-w-md space-y-1">
              <p className="font-medium">{t("empty.title")}</p>
              <p className="text-muted-foreground text-sm">{t("empty.description")}</p>
            </div>
            {canWrite && (
              <div className="flex flex-wrap justify-center gap-2">
                <Button type="button" variant="outline" onClick={startWithBasics} disabled={starting}>
                  {starting ? <Loader2Icon className="animate-spin" /> : null}
                  {t("empty.starters")}
                </Button>
                <Button type="button" onClick={() => setForm({ ...EMPTY })}>
                  <PlusIcon />
                  {t("new")}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <p className="py-8 text-center text-muted-foreground text-sm">{t("noMatch")}</p>
      ) : (
        <div className="space-y-6">
          {mine.length > 0 && (
            <section className="space-y-3">
              <h2 className="font-semibold text-sm">{t("mine", { count: mine.length })}</h2>
              <div className="grid gap-3 md:grid-cols-2">{mine.map(card)}</div>
            </section>
          )}
          {team.length > 0 && (
            <section className="space-y-3">
              <h2 className="font-semibold text-sm">{t("team", { count: team.length })}</h2>
              <div className="grid gap-3 md:grid-cols-2">{team.map(card)}</div>
            </section>
          )}
        </div>
      )}

      {/* ── Editor ──────────────────────────────────────────────────────── */}
      <Dialog open={form !== null} onOpenChange={(v) => !v && setForm(null)}>
        <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
          <DialogHeader className="shrink-0 border-b px-5 py-4">
            <DialogTitle>{form?.id ? t("editTitle") : t("newTitle")}</DialogTitle>
            <DialogDescription>{t("editorHint")}</DialogDescription>
          </DialogHeader>
          {form && (
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="tpl-name">{t("fields.name")}</Label>
                  <Input
                    id="tpl-name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder={t("fields.namePlaceholder")}
                    maxLength={120}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t("fields.category")}</Label>
                  <Select
                    value={form.category}
                    onValueChange={(v) => setForm({ ...form, category: v as PersonalCategory })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PERSONAL_CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {t(`categories.${c}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tpl-subject">{t("fields.subject")}</Label>
                <Input
                  id="tpl-subject"
                  value={form.subject}
                  onChange={(e) => setForm({ ...form, subject: e.target.value })}
                  placeholder={t("fields.subjectPlaceholder")}
                  maxLength={300}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("fields.body")}</Label>
                <RichTextEditor
                  variant="email"
                  value={form.body}
                  onChange={(html) => setForm((f) => (f ? { ...f, body: html } : f))}
                  placeholder={t("fields.bodyPlaceholder")}
                  editorClassName="min-h-[240px]"
                />
              </div>
              <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div className="min-w-0">
                  <Label htmlFor="tpl-shared">{t("fields.shared")}</Label>
                  <p className="text-muted-foreground text-xs">{t("fields.sharedHint")}</p>
                </div>
                <Switch
                  id="tpl-shared"
                  checked={form.isPublic}
                  onCheckedChange={(v) => setForm({ ...form, isPublic: v })}
                />
              </div>
            </div>
          )}
          <DialogFooter className="shrink-0 border-t px-5 py-3">
            <Button type="button" variant="ghost" onClick={() => setForm(null)}>
              {t("cancel")}
            </Button>
            <Button type="button" onClick={save} disabled={saving || !formValid}>
              {saving ? <Loader2Icon className="animate-spin" /> : null}
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleting !== null} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.isPublic
                ? t("deleteSharedDescription", { name: deleting?.name ?? "" })
                : t("deleteDescription", { name: deleting?.name ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={remove}>{t("delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
