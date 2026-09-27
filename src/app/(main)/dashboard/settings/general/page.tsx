import { getGeneralSettings } from "@/actions/workspace-settings";
import { requirePageCapability } from "@/lib/page-guard";

import { GeneralSettingsClient } from "./_components/general-settings-client";

export default async function GeneralSettingsPage() {
  await requirePageCapability("settings:manage", "/dashboard/settings/general");
  const settings = await getGeneralSettings();
  return <GeneralSettingsClient {...settings} />;
}
