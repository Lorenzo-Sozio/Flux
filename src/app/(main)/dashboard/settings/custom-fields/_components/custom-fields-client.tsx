"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Plus, Trash2, Settings2 } from "lucide-react";
import {
  createCustomFieldDefinition,
  deleteCustomFieldDefinition,
  type EntityType,
  type FieldType,
} from "@/actions/custom-fields";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Field = {
  id: string;
  name: string;
  slug: string;
  entityType: string;
  fieldType: string;
  options: string | null;
  isRequired: boolean;
  order: number;
};

const ENTITY_TYPES: EntityType[] = ["contact", "lead", "company", "deal"];
const FIELD_TYPE_VALUES: FieldType[] = ["text", "number", "date", "select", "multiselect", "boolean", "url"];

interface Props {
  fields: Field[];
  currentUserId: string;
}

export function CustomFieldsClient({ fields: initialFields, currentUserId }: Props) {
  const t = useTranslations("settings.customFields");
  const tc = useTranslations("common");
  const [fields, setFields] = useState(initialFields);
  const [addOpen, setAddOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [form, setForm] = useState<{
    name: string;
    entityType: EntityType;
    fieldType: FieldType;
    options: string;
    isRequired: boolean;
  }>({
    name: "",
    entityType: "contact",
    fieldType: "text",
    options: "",
    isRequired: false,
  });

  const handleAdd = async () => {
    if (!form.name.trim()) return;
    setIsPending(true);
    try {
      const slug = form.name.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
      const options =
        ["select", "multiselect"].includes(form.fieldType) && form.options
          ? form.options.split(",").map((o) => o.trim()).filter(Boolean)
          : undefined;

      const field = await createCustomFieldDefinition({
        name: form.name.trim(),
        slug,
        entityType: form.entityType,
        fieldType: form.fieldType,
        options,
        isRequired: form.isRequired,
        ownerId: currentUserId,
      });

      setFields((prev) => [...prev, field as Field]);
      toast.success(t("createSuccess"));
      setAddOpen(false);
      setForm({ name: "", entityType: "contact", fieldType: "text", options: "", isRequired: false });
    } catch {
      toast.error(t("createFailed"));
    } finally {
      setIsPending(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t("deleteConfirm"))) return;
    try {
      await deleteCustomFieldDefinition(id);
      setFields((prev) => prev.filter((f) => f.id !== id));
      toast.success(t("deleteSuccess"));
    } catch {
      toast.error(t("deleteFailed"));
    }
  };

  const groupedByEntity = ENTITY_TYPES.reduce<Record<string, Field[]>>((acc, et) => {
    acc[et] = fields.filter((f) => f.entityType === et);
    return acc;
  }, {} as Record<string, Field[]>);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          {t("addField")}
        </Button>
      </div>

      {ENTITY_TYPES.map((et) => (
        <Card key={et}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings2 className="h-4 w-4" />
              {t("entityTitle", { entity: t(`entityTypes.${et as "contact" | "lead" | "company" | "deal"}`) })}
            </CardTitle>
            <CardDescription>
              {t("fieldCount", { count: groupedByEntity[et]?.length ?? 0 })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {groupedByEntity[et]?.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                {t("noFieldsForEntity", { entity: t(`entityTypes.${et as "contact" | "lead" | "company" | "deal"}`) })}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("columns.name")}</TableHead>
                    <TableHead>{t("columns.slug")}</TableHead>
                    <TableHead>{t("columns.type")}</TableHead>
                    <TableHead>{t("required")}</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groupedByEntity[et].map((field) => (
                    <TableRow key={field.id}>
                      <TableCell className="font-medium">{field.name}</TableCell>
                      <TableCell>
                        <code className="rounded bg-muted px-1 py-0.5 text-xs">{field.slug}</code>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {field.fieldType}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {field.isRequired ? (
                          <Badge variant="destructive" className="text-[10px]">{t("requiredBadge")}</Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">{t("optionalLabel")}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => handleDelete(field.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ))}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("dialog.title")}</DialogTitle>
            <DialogDescription>{t("dialog.description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>{t("dialog.fieldNameLabel")}</Label>
              <Input
                placeholder="e.g. LinkedIn URL"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t("entityType")}</Label>
                <Select
                  value={form.entityType}
                  onValueChange={(v) => setForm((f) => ({ ...f, entityType: v as EntityType }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ENTITY_TYPES.map((et) => (
                      <SelectItem key={et} value={et}>
                        {t(`entityTypes.${et as "contact" | "lead" | "company" | "deal"}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t("fieldType")}</Label>
                <Select
                  value={form.fieldType}
                  onValueChange={(v) => setForm((f) => ({ ...f, fieldType: v as FieldType }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FIELD_TYPE_VALUES.map((ft) => (
                      <SelectItem key={ft} value={ft}>
                        {t(`fieldTypes.${ft as "text" | "number" | "date" | "select" | "multiselect" | "boolean" | "url"}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {["select", "multiselect"].includes(form.fieldType) && (
              <div className="space-y-1.5">
                <Label>{t("dialog.optionsLabel")}</Label>
                <Input
                  placeholder="Option A, Option B, Option C"
                  value={form.options}
                  onChange={(e) => setForm((f) => ({ ...f, options: e.target.value }))}
                />
              </div>
            )}
            <div className="flex items-center justify-between rounded-lg border p-3">
              <Label htmlFor="field-required" className="cursor-pointer">
                {t("dialog.requiredField")}
              </Label>
              <Switch
                id="field-required"
                checked={form.isRequired}
                onCheckedChange={(v) => setForm((f) => ({ ...f, isRequired: v }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>{tc("cancel")}</Button>
            <Button onClick={handleAdd} disabled={isPending || !form.name}>
              {isPending ? t("dialog.creating") : t("dialog.createField")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
