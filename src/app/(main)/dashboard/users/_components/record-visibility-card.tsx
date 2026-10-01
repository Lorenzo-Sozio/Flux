"use client";

import { useState, useTransition } from "react";

import { EyeOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { setRecordVisibilityAction } from "@/actions/record-visibility";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { VisibilityMode } from "@/lib/record-visibility";

/** Settings → Users: whether salespeople see each other's customers (src/lib/record-visibility.ts). */
export function RecordVisibilityCard({ initial }: { initial: VisibilityMode }) {
  const t = useTranslations("users.visibility");
  const [mode, setMode] = useState<VisibilityMode>(initial);
  const [pending, startTransition] = useTransition();

  const choose = (next: string) => {
    const value = next as VisibilityMode;
    const previous = mode;
    setMode(value);
    startTransition(async () => {
      const result = await setRecordVisibilityAction(value).catch(() => ({ ok: false }));
      if (result.ok) toast.success(t("saved"));
      else {
        setMode(previous);
        toast.error(t("failed"));
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <EyeOff className="h-5 w-5 shrink-0" />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("desc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <RadioGroup value={mode} onValueChange={choose} disabled={pending}>
          {(["team", "all"] as const).map((value) => (
            <Label
              key={value}
              htmlFor={`visibility-${value}`}
              className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal has-[[data-state=checked]]:border-primary"
            >
              <RadioGroupItem id={`visibility-${value}`} value={value} className="mt-0.5" />
              <span className="min-w-0 space-y-1">
                <span className="block font-medium text-sm">{t(`${value}.label`)}</span>
                <span className="block text-muted-foreground text-xs">{t(`${value}.desc`)}</span>
              </span>
            </Label>
          ))}
        </RadioGroup>
        <p className="text-muted-foreground text-xs">{t("adminsSeeAll")}</p>
      </CardContent>
    </Card>
  );
}
