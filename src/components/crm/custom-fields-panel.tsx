"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Settings2, Save, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { upsertCustomFieldValue } from "@/actions/custom-fields";
import type { EntityType } from "@/actions/custom-fields";

type FieldDef = {
  id: string;
  name: string;
  slug: string;
  fieldType: string;
  options: string | null;
  isRequired: boolean;
};

type FieldValue = {
  fieldId: string;
  value: string | null;
};

interface Props {
  entityType: EntityType;
  entityId: string;
  definitions: FieldDef[];
  values: FieldValue[];
}

export function CustomFieldsPanel({ entityType, entityId, definitions, values }: Props) {
  const valueMap = Object.fromEntries(values.map((v) => [v.fieldId, v.value ?? ""]));
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(valueMap);
  const [saving, setSaving] = useState(false);

  if (definitions.length === 0) return null;

  const setVal = (id: string, v: string) =>
    setFieldValues((prev) => ({ ...prev, [id]: v }));

  const handleSave = async () => {
    setSaving(true);
    try {
      for (const [fieldId, value] of Object.entries(fieldValues)) {
        await upsertCustomFieldValue({ fieldId, entityType, entityId, value });
      }
      toast.success("Custom fields saved.");
    } catch {
      toast.error("Failed to save custom fields.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Settings2 className="h-4 w-4" />
          Custom Fields
          <Badge variant="secondary" className="text-[10px]">
            {definitions.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {definitions.map((def) => {
          const options = def.options ? (JSON.parse(def.options) as string[]) : [];
          const value = fieldValues[def.id] ?? "";

          return (
            <div key={def.id} className="space-y-1">
              <label className="text-[10px] uppercase font-semibold tracking-wide text-muted-foreground">
                {def.name}
                {def.isRequired && <span className="text-destructive ml-1">*</span>}
              </label>

              {(def.fieldType === "text" || def.fieldType === "url") && (
                <Input
                  type={def.fieldType === "url" ? "url" : "text"}
                  value={value}
                  onChange={(e) => setVal(def.id, e.target.value)}
                  className="h-8 text-sm"
                  placeholder={def.fieldType === "url" ? "https://" : ""}
                />
              )}

              {def.fieldType === "number" && (
                <Input
                  type="number"
                  value={value}
                  onChange={(e) => setVal(def.id, e.target.value)}
                  className="h-8 text-sm"
                />
              )}

              {def.fieldType === "date" && (
                <Input
                  type="date"
                  value={value}
                  onChange={(e) => setVal(def.id, e.target.value)}
                  className="h-8 text-sm"
                />
              )}

              {def.fieldType === "boolean" && (
                <select
                  value={value}
                  onChange={(e) => setVal(def.id, e.target.value)}
                  className="w-full h-8 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">—</option>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              )}

              {def.fieldType === "select" && (
                <select
                  value={value}
                  onChange={(e) => setVal(def.id, e.target.value)}
                  className="w-full h-8 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Select…</option>
                  {options.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              )}

              {def.fieldType === "multiselect" && (
                <div className="flex flex-wrap gap-1 p-2 border rounded-md min-h-8">
                  {options.map((opt) => {
                    const selected = value.split(",").filter(Boolean).includes(opt);
                    return (
                      <Badge
                        key={opt}
                        variant={selected ? "default" : "outline"}
                        className="cursor-pointer text-xs h-5"
                        onClick={() => {
                          const current = value ? value.split(",").filter(Boolean) : [];
                          const next = selected
                            ? current.filter((v) => v !== opt)
                            : [...current, opt];
                          setVal(def.id, next.join(","));
                        }}
                      >
                        {opt}
                      </Badge>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        <Button size="sm" onClick={handleSave} disabled={saving} className="w-full mt-2">
          {saving ? (
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="mr-2 h-3.5 w-3.5" />
          )}
          Save Custom Fields
        </Button>
      </CardContent>
    </Card>
  );
}
