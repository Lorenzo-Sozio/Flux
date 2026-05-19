"use client";

import { useState } from "react";

import { Globe, Lock, Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { createMacroAction, deleteMacroAction, updateMacroAction } from "@/actions/support";
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
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface Macro {
  id: string;
  name: string;
  description: string | null;
  body: string;
  isPublic: boolean;
  creator?: { name: string | null; email: string | null } | null;
}

const EMPTY_FORM = { name: "", description: "", body: "", isPublic: true };

export function MacrosClient({ macros: initial }: { macros: Macro[] }) {
  const t = useTranslations("support.macros");
  const [macros, setMacros] = useState<Macro[]>(initial);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Macro | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (macro: Macro) => {
    setEditing(macro);
    setForm({
      name: macro.name,
      description: macro.description ?? "",
      body: macro.body,
      isPublic: macro.isPublic,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.body.trim() || form.body === "<p></p>") {
      toast.error(t("nameBodyRequired"));
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        const result = await updateMacroAction(editing.id, form);
        setMacros((prev) => prev.map((m) => (m.id === editing.id ? result.macro : m)));
        toast.success(t("updateSuccess"));
      } else {
        const result = await createMacroAction(form);
        setMacros((prev) => [...prev, result.macro]);
        toast.success(t("createSuccess"));
      }
      setDialogOpen(false);
    } catch {
      toast.error(t("saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteMacroAction(deleteId);
      setMacros((prev) => prev.filter((m) => m.id !== deleteId));
      toast.success(t("deleteSuccess"));
    } catch {
      toast.error(t("deleteFailed"));
    } finally {
      setDeleteId(null);
    }
  };

  // Strip HTML for preview snippet
  const plainPreview = (html: string, max = 120) => {
    const plain = html
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return plain.length > max ? plain.slice(0, max) + "…" : plain;
  };

  return (
    <>
      <div className="flex justify-end">
        <Button onClick={openCreate} className="gap-2">
          <Plus className="h-4 w-4" />
          {t("newMacro")}
        </Button>
      </div>

      {macros.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <p className="text-muted-foreground text-sm">{t("noMacros")}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {macros.map((macro) => (
            <Card key={macro.id}>
              <CardContent className="p-4 flex items-start gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-semibold text-sm">{macro.name}</span>
                    <Badge variant="outline" className="text-[10px] h-4 gap-1 px-1.5">
                      {macro.isPublic ? (
                        <>
                          <Globe className="h-2.5 w-2.5" /> {t("publicBadge")}
                        </>
                      ) : (
                        <>
                          <Lock className="h-2.5 w-2.5" /> {t("internalBadge")}
                        </>
                      )}
                    </Badge>
                  </div>
                  {macro.description && <p className="text-xs text-muted-foreground mb-2">{macro.description}</p>}
                  <p className="text-xs bg-muted/50 rounded p-2 text-muted-foreground">{plainPreview(macro.body)}</p>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(macro)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={() => setDeleteId(macro.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? t("editMacro") : t("newMacro")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="macro-name">{t("nameLabel")}</Label>
              <Input
                id="macro-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder={t("namePlaceholder")}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="macro-desc">{t("descriptionLabel")}</Label>
              <Input
                id="macro-desc"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder={t("descriptionPlaceholder")}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label>
                {t("bodyLabel")} <span className="text-muted-foreground font-normal text-xs">— {t("bodyHint")}</span>
              </Label>
              <div className="mt-1.5">
                <RichTextEditor
                  value={form.body}
                  onChange={(html) => setForm((f) => ({ ...f, body: html }))}
                  placeholder={t("bodyPlaceholder")}
                  macroVariables
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id="macro-public"
                checked={form.isPublic}
                onCheckedChange={(v) => setForm((f) => ({ ...f, isPublic: v }))}
              />
              <Label htmlFor="macro-public" className="cursor-pointer">
                {form.isPublic ? t("publicTemplate") : t("internalTemplate")}
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t("cancel")}
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? t("saving") : editing ? t("update") : t("create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("deleteDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
