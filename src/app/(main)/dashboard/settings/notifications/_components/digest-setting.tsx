"use client";

import { useState, useTransition } from "react";

import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";

import { setDigestPreferenceAction } from "@/actions/digest";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

/** The morning email that replaced one email per task. */
export function DigestSetting({ initial }: { initial: boolean }) {
  const t = useTranslations("digestSetting");
  const locale = useLocale();
  const [on, setOn] = useState(initial);
  const [pending, startTransition] = useTransition();

  const toggle = (next: boolean) => {
    setOn(next);
    startTransition(async () => {
      try {
        await setDigestPreferenceAction(next, locale);
        toast.success(t("saved"));
      } catch {
        setOn(!next);
        toast.error(t("failed"));
      }
    });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <CardTitle className="text-base">{t("title")}</CardTitle>
          <CardDescription>{t("help")}</CardDescription>
        </div>
        <Switch checked={on} disabled={pending} onCheckedChange={toggle} aria-label={t("title")} />
      </CardHeader>
    </Card>
  );
}
