import { getTranslations } from "next-intl/server";

import { getIssuerProfile } from "@/actions/invoicing";
import { getSdiSettings } from "@/actions/sdi";
import { requirePageCapability } from "@/lib/page-guard";

import { IssuerForm } from "./_components/issuer-form";
import { SdiSettingsForm } from "./_components/sdi-settings-form";

export default async function InvoicingSettingsPage() {
  await requirePageCapability("invoicing:manage", "/dashboard/settings/invoicing");
  const [{ profile }, sdi, t] = await Promise.all([getIssuerProfile(), getSdiSettings(), getTranslations("invoicing")]);

  return (
    <div className="space-y-6">
      <div className="min-w-0">
        <h1 className="font-bold text-2xl tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>
      <IssuerForm initial={profile} />
      <SdiSettingsForm initial={sdi} />
    </div>
  );
}
