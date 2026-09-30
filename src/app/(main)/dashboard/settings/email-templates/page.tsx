import { getTranslations } from "next-intl/server";

import { getPersonalTemplates } from "@/actions/email-templates";
import { requirePageCapability } from "@/lib/page-guard";
import { can } from "@/lib/permissions";

import { EmailTemplatesClient } from "./_components/email-templates-client";

/**
 * The text an email to a customer starts from (src/lib/email-templates.ts): one's own, and the
 * ones the team shares. For everybody who writes to customers — no module needed; the campaign
 * templates stay in Marketing.
 */
export default async function EmailTemplatesPage() {
  const actor = await requirePageCapability("record:read", "/dashboard/settings/email-templates");
  const [templates, t] = await Promise.all([getPersonalTemplates(), getTranslations("emailTemplates")]);

  return (
    <div className="space-y-6">
      <div className="min-w-0">
        <h1 className="font-bold text-2xl tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-muted-foreground text-sm">{t("subtitle")}</p>
      </div>
      <EmailTemplatesClient templates={templates} canWrite={can(actor, "record:write")} userId={actor.userId} />
    </div>
  );
}
