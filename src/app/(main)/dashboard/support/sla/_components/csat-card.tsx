"use client";

import { useState, useTransition } from "react";

import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { setCsatSettingAction } from "@/actions/support-report";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/**
 * Whether resolving a ticket emails the customer and asks, with one click, how it went.
 * Off until somebody turns it on: it writes to customers, and a deploy is not that decision.
 */
export function CsatCard({ enabled: initial, ready }: { enabled: boolean; ready: boolean }) {
  const t = useTranslations("support.csat");
  const [enabled, setEnabled] = useState(initial);
  const [pending, startTransition] = useTransition();

  const change = (next: boolean) =>
    startTransition(async () => {
      try {
        await setCsatSettingAction(next);
        setEnabled(next);
        toast.success(next ? t("on") : t("off"));
      } catch {
        toast.error(t("failed"));
      }
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex min-h-11 items-center gap-3">
          <Switch id="csat-enabled" checked={enabled} disabled={pending || !ready} onCheckedChange={change} />
          <Label htmlFor="csat-enabled" className="cursor-pointer leading-snug">
            {t("label")}
          </Label>
        </div>
        {!ready && <p className="text-amber-700 text-sm dark:text-amber-400">{t("notReady")}</p>}
        <p className="text-muted-foreground text-xs">{t("help")}</p>
      </CardContent>
    </Card>
  );
}
