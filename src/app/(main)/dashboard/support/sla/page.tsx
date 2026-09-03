import { getTranslations } from "next-intl/server";

import { getAllSlas } from "@/actions/sla";
import { requirePageCapability } from "@/lib/page-guard";

import { SlaClient } from "./_components/sla-client";

export default async function SlaPage() {
  await requirePageCapability("sla:manage", "/dashboard/support/sla");

  const [slaList, t] = await Promise.all([getAllSlas(), getTranslations("support.sla")]);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="font-bold text-2xl tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>
      <SlaClient slas={slaList} />
    </div>
  );
}
