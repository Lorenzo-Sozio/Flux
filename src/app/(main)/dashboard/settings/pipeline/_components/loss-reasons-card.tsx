"use client";

import { useState } from "react";

import { Check, Pencil, Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { createLossReason, updateLossReason } from "@/actions/pipeline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

export type LossReasonRow = { id: string; name: string; order: number; isActive: boolean };

/**
 * The list a person picks from when a deal is lost. The actions existed with no screen,
 * so every workspace kept the seeded list for ever — and "why do we lose" is only a
 * report when the reasons are the ones this business actually has.
 *
 * ⚠️ Retire, never delete: deals already closed under a reason keep pointing at it, and
 * the loss report groups by its id. A retired reason stops being offered and stays in
 * the history.
 */
export function LossReasonsCard({ reasons: initial }: { reasons: LossReasonRow[] }) {
  const t = useTranslations("settings.pipeline.lossReasons");
  const tc = useTranslations("common");
  const [reasons, setReasons] = useState(initial);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [pending, setPending] = useState(false);

  const add = async () => {
    const name = draft.trim();
    if (!name) return;
    setPending(true);
    try {
      const row = await createLossReason(name);
      setReasons((prev) => [...prev, row]);
      setDraft("");
    } catch {
      toast.error(t("saveFailed"));
    } finally {
      setPending(false);
    }
  };

  const save = async (id: string, data: { name?: string; isActive?: boolean }) => {
    const before = reasons;
    setReasons((prev) => prev.map((r) => (r.id === id ? { ...r, ...data } : r)));
    try {
      await updateLossReason(id, data);
    } catch {
      setReasons(before);
      toast.error(t("saveFailed"));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {reasons.length === 0 && <p className="text-muted-foreground text-sm">{t("empty")}</p>}
        <ul className="space-y-2">
          {reasons.map((r) => (
            <li key={r.id} className="flex items-center gap-3 rounded-lg border bg-background px-3 py-2">
              {editing?.id === r.id ? (
                <form
                  className="flex min-w-0 flex-1 items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const name = editing.name.trim();
                    if (name) void save(r.id, { name });
                    setEditing(null);
                  }}
                >
                  <Input
                    autoFocus
                    value={editing.name}
                    onChange={(e) => setEditing({ id: r.id, name: e.target.value })}
                    aria-label={t("nameLabel")}
                  />
                  <Button type="submit" size="icon" variant="ghost" className="size-9 shrink-0" aria-label={tc("save")}>
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-9 shrink-0"
                    onClick={() => setEditing(null)}
                    aria-label={tc("cancel")}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </form>
              ) : (
                <>
                  <span className={`min-w-0 flex-1 break-words text-sm ${r.isActive ? "" : "text-muted-foreground"}`}>
                    {r.name}
                  </span>
                  {!r.isActive && (
                    <Badge variant="outline" className="shrink-0 text-xs">
                      {t("retired")}
                    </Badge>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-9 shrink-0 sm:size-7"
                    onClick={() => setEditing({ id: r.id, name: r.name })}
                    aria-label={t("rename")}
                    title={t("rename")}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Switch
                    checked={r.isActive}
                    onCheckedChange={(v) => void save(r.id, { isActive: v })}
                    aria-label={t("offered")}
                    title={t("offered")}
                  />
                </>
              )}
            </li>
          ))}
        </ul>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t("placeholder")}
            aria-label={t("nameLabel")}
          />
          <Button type="submit" disabled={pending || !draft.trim()} className="shrink-0">
            <Plus className="mr-2 h-4 w-4" />
            {t("add")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
