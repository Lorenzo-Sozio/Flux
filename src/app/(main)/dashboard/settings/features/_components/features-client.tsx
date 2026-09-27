"use client";

import { useState, useTransition } from "react";

import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { setWorkspaceFeatureAction } from "@/actions/workspace-settings";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { WORKSPACE_FEATURES, type WorkspaceFeature, type WorkspaceFeatures } from "@/lib/workspace-feature-list";

export function FeaturesClient({ initial }: { initial: WorkspaceFeatures }) {
  const t = useTranslations("settings.features");
  const [features, setFeatures] = useState(initial);
  const [pending, startTransition] = useTransition();

  const toggle = (feature: WorkspaceFeature, on: boolean) => {
    const before = features;
    setFeatures({ ...features, [feature]: on });
    startTransition(async () => {
      try {
        await setWorkspaceFeatureAction(feature, on);
        toast.success(t("saved"));
      } catch {
        setFeatures(before);
        toast.error(t("failed"));
      }
    });
  };

  return (
    <div className="grid gap-3">
      {WORKSPACE_FEATURES.map((feature) => (
        <Card key={feature}>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div className="min-w-0 space-y-1">
              <CardTitle className="text-base">{t(`${feature}.label`)}</CardTitle>
              <CardDescription>{t(`${feature}.help`)}</CardDescription>
            </div>
            <Switch
              checked={features[feature]}
              disabled={pending}
              onCheckedChange={(on) => toggle(feature, on)}
              aria-label={t(`${feature}.label`)}
            />
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}
