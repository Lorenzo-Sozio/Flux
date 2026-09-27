import { TargetIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { getCampaignsWithStats, getEmailTemplates } from "@/actions/marketing";

import { CampaignsClient } from "./_components/campaigns-client";
import { NewCampaignButton } from "./_components/new-campaign-button";

export default async function CampaignsPage() {
  const t = await getTranslations("marketing.campaigns");
  const [campaigns, templates] = await Promise.all([getCampaignsWithStats(), getEmailTemplates()]);

  return (
    <div className="space-y-6">
      {/* Wrapping, not shrinking: on a phone the button drops under the title
          instead of pushing past the edge of the screen. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 font-bold text-2xl">
            <TargetIcon className="h-6 w-6 shrink-0 text-primary" />
            {t("title")}
          </h1>
          <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
        </div>
        <NewCampaignButton templates={templates} />
      </div>

      <CampaignsClient campaigns={campaigns} templates={templates} />
    </div>
  );
}
