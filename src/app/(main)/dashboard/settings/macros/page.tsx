import { getTranslations } from "next-intl/server";

import { getMacros } from "@/actions/support";
import { requirePageCapability } from "@/lib/page-guard";

import { MacrosClient } from "./_components/macros-client";

export default async function MacrosPage() {
  // A session alone was the whole check, so a member of a workspace whose plan
  // has no support module reached the page and then met a raw error from the
  // action underneath — the shape audit rilievo D-08 is about. The page guard
  // redirects and says why.
  await requirePageCapability("ticket:read", "/dashboard/settings/macros");

  const [macros, t] = await Promise.all([getMacros(), getTranslations("support.macros")]);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="font-bold text-2xl tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>
      <MacrosClient macros={macros} />
    </div>
  );
}
