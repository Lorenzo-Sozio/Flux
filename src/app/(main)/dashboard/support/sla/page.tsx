import { getTranslations } from "next-intl/server";

import { getAllSlas } from "@/actions/sla";
import { getBusinessCalendar } from "@/actions/support";
import { getCsatSetting } from "@/actions/support-report";
import { getGroupsForSelect } from "@/actions/user-groups";
import { getAppUrlOrNull } from "@/lib/app-url";
import { requirePageCapability } from "@/lib/page-guard";

import { BusinessHoursCard } from "./_components/business-hours-card";
import { CsatCard } from "./_components/csat-card";
import { SlaClient } from "./_components/sla-client";

export default async function SlaPage() {
  await requirePageCapability("sla:manage", "/dashboard/support/sla");

  const [slaList, calendar, groups, csat, t] = await Promise.all([
    getAllSlas(),
    getBusinessCalendar(),
    // The policy escalates to a group, so the form has to know which ones exist.
    getGroupsForSelect(),
    getCsatSetting(),
    getTranslations("support.sla"),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-bold text-2xl tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>
      <SlaClient slas={slaList} groups={groups} />

      {/* What "four hours" means. Without it the promise runs overnight and over
          the weekend, and every support metric is wrong the same way. */}
      <BusinessHoursCard
        timeZone={calendar.timeZone}
        week={calendar.week}
        holidays={calendar.holidays}
        ready={calendar.ready}
      />

      {/* The other half of a promise: asking whether it was kept (src/lib/ticket-public.ts). */}
      <CsatCard enabled={csat.enabled} ready={getAppUrlOrNull() !== null} />
    </div>
  );
}
