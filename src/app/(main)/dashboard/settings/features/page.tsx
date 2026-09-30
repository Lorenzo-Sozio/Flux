import { getTranslations } from "next-intl/server";

import { aiOfferedToWorkspace } from "@/lib/ai/access";
import { requirePageCapability } from "@/lib/page-guard";
import { getDb } from "@/lib/tenant-context";
import { readWorkspaceFeatures, WORKSPACE_FEATURES } from "@/lib/workspace-features";

import { FeaturesClient } from "./_components/features-client";

export default async function FeaturesPage() {
  await requirePageCapability("settings:manage", "/dashboard/settings/features");
  const t = await getTranslations("settings.features");
  const [features, aiOffered] = await Promise.all([readWorkspaceFeatures(await getDb()), aiOfferedToWorkspace()]);
  const offered = WORKSPACE_FEATURES.filter((f) => f !== "ai" || aiOffered);

  return (
    <div className="space-y-6">
      <div className="min-w-0">
        <h1 className="font-bold text-2xl tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-muted-foreground text-sm">{t("intro")}</p>
      </div>
      <FeaturesClient initial={features} offered={offered} />
    </div>
  );
}
