"use client";

import { useState } from "react";

import { BookmarkPlusIcon, Loader2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { saveTemplateAction } from "@/actions/email-templates";
import { Button } from "@/components/ui/button";
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
import { type ComposerTemplate, PERSONAL_CATEGORIES, type PersonalCategory } from "@/lib/email-template-rules";

/**
 * The email being written, kept as a template for next time: its subject and body as they are,
 * fields like {{nome}} included, so the next recipient gets their own.
 */
export function SaveAsTemplateButton({
  subject,
  body,
  disabled,
  onSaved,
}: {
  subject: string;
  body: () => string;
  disabled?: boolean;
  onSaved: (template: ComposerTemplate) => void;
}) {
  const t = useTranslations("emailTemplates");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<PersonalCategory>("followup");
  const [isPublic, setIsPublic] = useState(false);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const html = body();
      const result = await saveTemplateAction({ name, category, subject, body: html, isPublic });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      onSaved({
        id: result.id,
        name: name.trim(),
        subject,
        body: html,
        kind: "personal",
        category,
        isPublic,
        mine: true,
      });
      toast.success(t("saved"));
      setOpen(false);
      setName("");
    } catch {
      toast.error(t("errors.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)} disabled={disabled}>
        <BookmarkPlusIcon className="text-muted-foreground" />
        {t("saveAs.trigger")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("saveAs.title")}</DialogTitle>
            <DialogDescription>{t("saveAs.description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="template-name">{t("fields.name")}</Label>
              <Input
                id="template-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("fields.namePlaceholder")}
                maxLength={120}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("fields.category")}</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as PersonalCategory)}>
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
            <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div className="min-w-0">
                <Label htmlFor="template-shared">{t("fields.shared")}</Label>
                <p className="text-muted-foreground text-xs">{t("fields.sharedHint")}</p>
              </div>
              <Switch id="template-shared" checked={isPublic} onCheckedChange={setIsPublic} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button type="button" onClick={save} disabled={saving || !name.trim()}>
              {saving ? <Loader2Icon className="animate-spin" /> : null}
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
