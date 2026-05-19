import { TargetIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { getCampaignsWithStats, getEmailTemplates } from "@/actions/marketing";

import { CampaignsClient } from "./_components/campaigns-client";
import { NewCampaignButton } from "./_components/new-campaign-button";

export default async function CampaignsPage() {
  const t = await getTranslations("marketing.campaigns");
  const [campaigns, templates] = await Promise.all([getCampaignsWithStats(), getEmailTemplates()]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <TargetIcon className="w-6 h-6 text-primary" />
            {t("title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <NewCampaignButton templates={templates} />
      </div>

      <CampaignsClient campaigns={campaigns} templates={templates} />
    </div>
  );
}
