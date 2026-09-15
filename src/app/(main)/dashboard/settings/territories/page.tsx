import { getTranslations } from "next-intl/server";

import { getTerritories } from "@/actions/territories";
import { requirePageCapability } from "@/lib/page-guard";

import { TerritoriesClient } from "./_components/territories-client";

export default async function TerritoriesPage() {
  await requirePageCapability("territory:manage", "/dashboard/settings/territories");

  const [territories, t] = await Promise.all([getTerritories(), getTranslations("settings.territories")]);

  return (
    <div className="space-y-6">
      <div className="min-w-0">
        <h1 className="font-bold text-2xl tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>
      <TerritoriesClient initial={territories} />
    </div>
  );
}
